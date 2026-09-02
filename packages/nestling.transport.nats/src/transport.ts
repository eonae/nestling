/**
 * `NatsBus` — шина приложения на брокере: снаружи `IMessageBus`, изнутри
 * `ITransport`.
 *
 * Использует ту же форму и тот же токен (`BusTransport$`), что и
 * `InProcessBus`: брокер не добавляется к in-proc шине, а заменяет её.
 *
 * Фазы жизненного цикла:
 *
 * - **INIT** — `connect()` захватывает соединение: оно ресурс, и к
 *   `@OnStart` исходящая сторона уже работает.
 * - **WIRE** — `attach(dispatch)` запоминает маршруты и проверяет формы io,
 *   подписок ещё нет.
 * - **START** — `serve(dispatch, signal)` создаёт подписки. Входящее
 *   сообщение не может застать незавершённый `@OnStart`.
 * - **SHUTDOWN** — `close()` или сигнал запускают дренаж: неподтверждённые
 *   durable-сообщения возвращаются в поток и достаются другой реплике.
 */

import { NatsConfig } from './config.js';
import type {
  NatsConnector,
  NatsJetStreamManagerLike,
  NatsJsMsgLike,
  NatsLike,
  NatsMsgLike,
  NatsSubscriptionLike,
} from './connector.js';
import { defaultConnector } from './connector.js';
import { consumerNameOf, groupOf, streamNameOf } from './subject.js';
import type { NatsCodec, WireEnvelope } from './wire.js';
import { decodeEnvelope, encodeEnvelope, jsonCodec } from './wire.js';

import type { ConfigProjection } from '@nestling/config';
import type { InjectionToken } from '@nestling/container';
import { factoryProvider, OnInit } from '@nestling/container';
import type {
  EndpointMeta,
  FormKind,
  Raw,
  ResponseContext,
  TransportCapabilities,
  UnknownFailInfo,
} from '@nestling/pipeline';
import {
  assertFormsSupported,
  DeadlineExceeded,
  makeEmptyContext,
  UnknownError,
} from '@nestling/pipeline';
import type {
  BusHandler,
  BusMessageMeta,
  BusSubscription,
  IMessageBus,
  PublishOptions,
  RequestOptions,
  SubscribeOptions,
} from '@nestling/ports';
import {
  BUS_TRANSPORT_NAME,
  busBindingOf,
  BusTransport$,
  deadlineFromTimeout,
  failureResponse,
  isExhausted,
  profileAttributes,
  startBudget,
} from '@nestling/ports';
import type {
  BusDeclaration,
  Dispatch,
  ITransport,
  RouteDeclaration,
} from '@nestling/transport';
import {
  DEFAULT_INSTANCE,
  makeTransportDeclaration,
} from '@nestling/transport';

/** Проекция конфиг-секции транспорта — то, что инжектится в фабрику */
type NatsConfigValues = ConfigProjection<typeof NatsConfig>;

/**
 * Способности шины по формам io: только value с обеих сторон.
 *
 * Те же, что у in-proc шины, и по той же причине: стриминг по шине вне V1,
 * и объявлять способность, которой нет, транспорт не станет.
 */
const BUS_CAPABILITIES: TransportCapabilities = {
  input: new Set<FormKind>(['value']),
  output: new Set<FormKind>(['value']),
};

/** Лимит попыток durable-доставки: умолчание, словарём не открывается */
const DEFAULT_MAX_DELIVER = 5;

/**
 * Проверяет, что обработка завершилась решением.
 *
 * Решение — это успех или любой отказ с кодом, кроме `UNKNOWN`. Код
 * `UNKNOWN` означает, что решения не получилось: в него необработанное
 * исключение превращает проверка на границе пайплайна.
 */
function isSettled(response: ResponseContext): boolean {
  return (
    response.isSuccess ||
    (response.value?.code !== undefined &&
      response.value.code !== UnknownError.code)
  );
}

/** Смена состояния соединения — диагностический канал, а не отказ вызова */
export interface NatsConnectionInfo {
  readonly state: 'connected' | 'closed';
  readonly error?: unknown;
}

/** Отчёт о доставке, прекращённой после исчерпания попыток */
export interface NatsDeliveryFailure {
  readonly subject: string;
  readonly error: unknown;

  /** Сообщение снято с доставки: попытки исчерпаны */
  readonly terminated?: boolean;
}

/** Опции транспорта: всё, что не про окружение */
export interface NatsTransportOptions {
  /** Адреса кластера; заданные явно сильнее конфига */
  servers?: readonly string[];

  /** Потолок ожидания req-reply в миллисекундах */
  requestTimeout?: number;

  /** Префикс subject'ов: разделение окружений на общем кластере */
  subjectPrefix?: string;

  /** Шов тестируемости: чем получить клиента брокера */
  connect?: NatsConnector;

  /** Кодек тела сообщения; умолчание — JSON */
  codec?: NatsCodec;

  /** Лимит попыток durable-доставки */
  maxDeliver?: number;

  /** Диагностический хук отказов доставки */
  onDeliveryFailure?: (info: NatsDeliveryFailure) => void;

  /** Диагностический хук смены состояния соединения */
  onConnectionChange?: (info: NatsConnectionInfo) => void;

  /**
   * Диагностический хук: необработанное исключение входящего сообщения
   * стало отказом `UNKNOWN`
   */
  onUnknownFail?: (info: UnknownFailInfo) => void;
}

/**
 * Шина приложения на NATS.
 *
 * Регистрируется фабрикой {@link nats} под токеном `BusTransport$` — тем
 * же, которым пользуется in-proc шина. Ни одна декларация `implement(...)`,
 * ни одна операция и ни один call-site при подключении не меняются: это и
 * есть уровень L4.
 */
export class NatsBus implements IMessageBus, ITransport {
  /** Способности транспорта: читает `assertFormsSupported` на сборке */
  readonly capabilities: TransportCapabilities = BUS_CAPABILITIES;

  /** Доставляет за пределы процесса — вход биндинга вызывателей */
  readonly remote = true;

  /** Умеет долговечную доставку: под ней JetStream */
  readonly durable = true;

  readonly #options: NatsTransportOptions;
  readonly #codec: NatsCodec;
  readonly #closing = new AbortController();

  #connection?: NatsLike;
  #dispatch?: Dispatch;
  #subscriptions: NatsSubscriptionLike[] = [];
  #closed = false;

  constructor(options: NatsTransportOptions = {}) {
    this.#options = options;
    this.#codec = options.codec ?? jsonCodec;
  }

  /**
   * Захватывает соединение — фаза INIT.
   *
   * Именно здесь, а не в момент первой отправки: соединение это ресурс, и
   * к `@OnStart` исходящая сторона обязана быть работоспособной. Вызов
   * порта из `@OnStart` уходит на брокер.
   */
  @OnInit()
  async connect(): Promise<void> {
    if (this.#connection) {
      return;
    }

    const connector = this.#options.connect ?? defaultConnector;

    this.#connection = await connector({
      servers: this.#options.servers ?? ['nats://127.0.0.1:4222'],
    });

    this.#report({ state: 'connected' });

    // Реконнект — забота клиента брокера. Транспорт лишь сообщает о смене
    // состояния и не изобретает собственной очереди переотправки: она была
    // бы outbox'ом, а outbox отложен
    void this.#connection
      .closed()
      .then((error) =>
        this.#report({ state: 'closed', ...(error ? { error } : {}) }),
      )
      .catch((error: unknown) => this.#report({ state: 'closed', error }));
  }

  /**
   * Запоминает маршруты и проверяет формы io — шаг фазы WIRE.
   *
   * Подписок здесь нет: у брокера входящая и исходящая стороны расходятся
   * во времени, и приём запросов начинается только на фазе START.
   */
  attach(dispatch: Dispatch): void {
    if (this.#dispatch === dispatch) {
      return;
    }

    if (this.#dispatch) {
      throw new Error('NATS bus is already routing another dispatch');
    }

    for (const route of dispatch.routes) {
      assertFormsSupported(route, this.capabilities);
    }

    this.#dispatch = dispatch;
  }

  /**
   * Запускает приём входящих сообщений: подписывается на subject'ы своих
   * маршрутов.
   *
   * Выполняется на фазе START, после `@OnStart`: входящее сообщение не
   * может застать незавершённый `@OnStart`.
   */
  async serve(dispatch: Dispatch, signal: AbortSignal): Promise<void> {
    this.attach(dispatch);
    await this.connect();

    if (signal.aborted) {
      this.#closing.abort();

      return;
    }

    signal.addEventListener('abort', () => this.#closing.abort(), {
      once: true,
    });

    for (const route of dispatch.routes) {
      const binding = busBindingOf(route);

      if (!binding) {
        continue;
      }

      const group = groupOf(binding, route.pattern);

      if (binding.durable) {
        await this.#serveDurable(route, binding.subject, group);
        continue;
      }

      this.#subscriptions.push(
        this.#subscribeRaw(
          this.#subjectOf(binding.subject),
          (payload, meta) => this.#execute(route, payload, meta),
          group,
        ),
      );
    }
  }

  /**
   * Req-reply через брокер.
   *
   * Ожидание ограничено `min(остаток бюджета, потолок транспорта)`.
   * Потолок — свойство **сети**, а не дефолтный бюджет: он не
   * наследуется вглубь вызовов и виден в тексте отказа.
   */
  async request(
    subject: string,
    payload: unknown,
    options: RequestOptions = {},
  ): Promise<ResponseContext> {
    const connection = this.#requireConnection();
    const address = this.#subjectOf(subject);
    const ceiling = this.#options.requestTimeout ?? 30_000;
    const timeout = Math.max(
      1,
      options.timeoutMs === undefined
        ? ceiling
        : Math.min(options.timeoutMs, ceiling),
    );

    try {
      const reply = await connection.request(
        address,
        this.#codec.encode(payload),
        {
          timeout,
          headers: this.#envelope(connection, address, options),
        },
      );

      return this.#codec.decode(reply.data) as ResponseContext;
    } catch (error) {
      return this.#deliveryFailure(subject, error, {
        ceiling,
        budgeted: options.timeoutMs !== undefined,
      });
    }
  }

  /**
   * Fire-and-forget.
   *
   * Не-durable операция публикуется core-глаголом и резолвится по факту
   * постановки; durable — через поток и резолвится по факту **сохранения**.
   */
  async publish(
    subject: string,
    payload: unknown,
    options: PublishOptions = {},
  ): Promise<void> {
    const connection = this.#requireConnection();
    const address = this.#subjectOf(subject);
    const data = this.#codec.encode(payload);
    const headers = this.#envelope(connection, address, options);

    if (options.durable) {
      await this.#ensureStream(connection, address);
      await connection.jetstream().publish(address, data, { headers });

      return;
    }

    connection.publish(address, data, { headers });
  }

  /**
   * Подписка на subject — базовый механизм транспорта.
   *
   * Тем же глаголом выражается и wildcard-подписка
   * (`subscribe('orders.>', …)`): третьего понятия для деклараций это не
   * вводит. Wildcard — брокерская способность. In-proc шина трактует
   * subject буквально, и это различие задокументировано, а не
   * эмулируется.
   */
  subscribe(
    subject: string,
    handler: BusHandler,
    options: SubscribeOptions = {},
  ): BusSubscription {
    const subscription = this.#subscribeRaw(
      this.#subjectOf(subject),
      handler,
      options.group,
    );

    this.#subscriptions.push(subscription);

    return { unsubscribe: () => subscription.unsubscribe() };
  }

  /**
   * Дренаж — фаза SHUTDOWN.
   *
   * Новые сообщения не принимаются, сообщения в работе дорабатываются,
   * неподтверждённые durable-сообщения возвращаются в поток и достаются
   * другой реплике.
   */
  async close(): Promise<void> {
    if (this.#closed) {
      return;
    }

    this.#closed = true;
    this.#closing.abort();

    for (const subscription of this.#subscriptions) {
      subscription.unsubscribe();
    }
    this.#subscriptions = [];

    await this.#connection?.drain();
    this.#connection = undefined;
    this.#dispatch = undefined;
  }

  /** Подписка на «сырой» адрес: префикс уже применён вызывающим */
  #subscribeRaw(
    address: string,
    handler: BusHandler,
    group?: string,
  ): NatsSubscriptionLike {
    const connection = this.#requireConnection();

    const subscription = connection.subscribe(address, {
      ...(group === undefined ? {} : { queue: group }),
      callback: (error, msg) => {
        if (error) {
          this.#reportDelivery({ subject: address, error });

          return;
        }

        void this.#deliver(handler, msg);
      },
    });

    return subscription;
  }

  /** Доставка core-сообщения обработчику и, если ждут, ответ */
  async #deliver(handler: BusHandler, msg: NatsMsgLike): Promise<void> {
    const envelope = decodeEnvelope(msg.headers);

    try {
      const response = await handler(
        this.#codec.decode(msg.data),
        this.#metaOf(msg.subject, envelope),
      );

      if (response) {
        msg.respond(this.#codec.encode(response));
      }
    } catch (error) {
      this.#reportDelivery({ subject: msg.subject, error });

      // Ждущему ответа отказ передаётся значением. Fire-and-forget
      // адреса ответа не имеет, и там отчёт хуку — весь доступный канал
      msg.respond(this.#codec.encode(failureResponse(error)));
    }
  }

  /** Долговечная подписка: поток, durable-потребитель и ack по решению */
  async #serveDurable(
    route: RouteDeclaration,
    subject: string,
    group: string,
  ): Promise<void> {
    const connection = this.#requireConnection();
    const address = this.#subjectOf(subject);
    const stream = await this.#ensureStream(connection, address);
    const durable = consumerNameOf(stream, group);
    const maxDeliver = this.#options.maxDeliver ?? DEFAULT_MAX_DELIVER;

    const manager = await connection.jetstreamManager();
    await manager.consumers.add(stream, {
      durable_name: durable,
      ack_policy: 'explicit',
      filter_subject: address,
      max_deliver: maxDeliver,
    });

    const messages = await connection
      .jetstream()
      .subscribe(address, { stream, durable });

    void this.#consume(route, messages, maxDeliver);
  }

  /**
   * Цикл потребления durable-сообщений.
   *
   * Ack — по факту **решения**: успех и задекларированный `Fail` одинаково
   * означают «обработано», и повторять их бессмысленно. `nak` — только там,
   * где решения не получилось: необработанное исключение. Исчерпание
   * попыток снимает сообщение с доставки и уходит в диагностический хук —
   * собственной очереди «мёртвых» сообщений транспорт не заводит.
   */
  async #consume(
    route: RouteDeclaration,
    messages: AsyncIterable<NatsJsMsgLike>,
    maxDeliver: number,
  ): Promise<void> {
    for await (const msg of messages) {
      if (this.#closed) {
        // Остановка процесса с сообщением в работе: оно возвращается в
        // поток и достаётся другой реплике, а не теряется
        msg.nak();
        break;
      }

      const envelope = decodeEnvelope(msg.headers);

      try {
        const response = await this.#execute(
          route,
          this.#codec.decode(msg.data),
          this.#metaOf(msg.subject, envelope),
        );

        // Решение получено — подтверждаем. Успех и **задекларированный**
        // отказ одинаково означают «обработано»: повторять их бессмысленно,
        // второй раз обработчик решит то же самое. Исчерпанный в транзите
        // бюджет тоже решение: ждать ответа уже некому
        if (isSettled(response)) {
          msg.ack();

          continue;
        }

        this.#redeliver(msg, maxDeliver, response.value);
      } catch (error) {
        // Endpoint без pipeline отказ бросает: проверка на границе,
        // которая нормализует исключения, живёт в пайплайне, поэтому
        // исключение сюда доходит как есть
        this.#redeliver(msg, maxDeliver, error);
      }
    }
  }

  /**
   * Возвращает сообщение в поток — или снимает его с доставки, если
   * попытки исчерпаны.
   *
   * Очереди «мёртвых» сообщений транспорт не заводит: снятое сообщение
   * уходит отчётом в диагностический хук, и что с ним делать, решает
   * приложение.
   */
  #redeliver(msg: NatsJsMsgLike, maxDeliver: number, error: unknown): void {
    if (msg.redeliveryCount >= maxDeliver) {
      msg.term();
      this.#reportDelivery({ subject: msg.subject, error, terminated: true });

      return;
    }

    msg.nak();
    this.#reportDelivery({ subject: msg.subject, error });
  }

  /** Идемпотентно обеспечивает поток, покрывающий subject */
  async #ensureStream(connection: NatsLike, address: string): Promise<string> {
    const manager: NatsJetStreamManagerLike =
      await connection.jetstreamManager();
    const name = streamNameOf(address);

    // Существующий поток принимается **как есть**: retention, storage и
    // лимиты остаются зоной эксплуатации, транспорт их не переписывает
    // Потока может и не быть — это не ошибка, а первый запуск
    const existing = await manager.streams
      .info(name)
      .then((info) => info.config)
      .catch(() => null);

    if (existing) {
      if (!existing.subjects.includes(address)) {
        throw new Error(
          `NATS stream '${name}' already exists but does not cover subject ` +
            `'${address}': it covers ${existing.subjects.join(', ')}. Rename ` +
            `the contract or fix the stream — the transport will not rewrite ` +
            `a stream it did not define.`,
        );
      }

      return name;
    }

    await manager.streams.add({ name, subjects: [address] });

    return name;
  }

  /** Маршрутизирует входящее сообщение в исполнение endpoint'а */
  async #execute(
    route: RouteDeclaration,
    payload: unknown,
    meta: BusMessageMeta,
  ): Promise<ResponseContext> {
    const dispatch = this.#dispatch;

    if (!dispatch) {
      throw new Error(
        'NATS bus is not serving: call serve(dispatch, signal) first.',
      );
    }

    // Fail-fast до обработки: бюджет, исчерпанный в транзите, означает, что
    // ответа уже никто не ждёт — исполнять endpoint незачем
    if (isExhausted(meta.deadline)) {
      return failureResponse(DeadlineExceeded());
    }

    const raw: Raw = {
      transport: BUS_TRANSPORT_NAME,
      pattern: route.pattern,
      payload,
      // Тот же безусловный канал, что у in-proc шины и у вызывателя:
      // профиль и провозимый контекст лежат рядом с `subject`
      attributes: profileAttributes(meta),
    };

    const endpoint: EndpointMeta = {
      transport: BUS_TRANSPORT_NAME,
      pattern: route.pattern,
      input: route.input,
      output: route.output,
      errors: route.errors,
    };

    const budget = startBudget(meta.deadline, meta.signal);
    const ctx = makeEmptyContext(raw, endpoint, budget.signal);

    try {
      return await dispatch.call(route.pattern, ctx, {
        // По сети stack не передаётся
        exposeErrorDetails: false,
        ...(this.#options.onUnknownFail === undefined
          ? {}
          : { onUnknownFail: this.#options.onUnknownFail }),
      });
    } finally {
      budget.release();
    }
  }

  /** Конверт приёма: относительный timeout снова становится моментом */
  #metaOf(subject: string, envelope: WireEnvelope): BusMessageMeta {
    return {
      subject,
      signal: this.#closing.signal,
      ...(envelope.timeoutMs === undefined
        ? {}
        : { deadline: deadlineFromTimeout(envelope.timeoutMs) }),
      ...(envelope.idempotencyKey === undefined
        ? {}
        : { idempotencyKey: envelope.idempotencyKey }),
      ...(envelope.context === undefined ? {} : { context: envelope.context }),
    };
  }

  /** Отображает брокерский отказ в существующий словарь ответов границы */
  #deliveryFailure(
    subject: string,
    error: unknown,
    ceiling: { ceiling: number; budgeted: boolean },
  ): ResponseContext {
    const code = (error as { code?: string } | undefined)?.code;

    if (code === '503') {
      this.#reportDelivery({ subject, error });

      return {
        isSuccess: false,
        status: 'SERVICE_UNAVAILABLE',
        value: {
          error:
            `Bus request to '${subject}' was not delivered: no responders ` +
            `are listening on the broker.`,
        },
      };
    }

    if (code === 'TIMEOUT') {
      // Ответ — тот же `DEADLINE_EXCEEDED`, что дал бы бюджет: множество
      // ответов порта закрыто, и новых кодов транспорт не вводит. А вот
      // **текст** называет источник ожидания, потому что «кончился бюджет
      // вызова» и «кончился потолок транспорта» чинятся по-разному
      const reason = ceiling.budgeted
        ? `the call budget ran out while waiting for the broker`
        : `the NATS request ceiling of ${ceiling.ceiling}ms ` +
          `(NATS_REQUEST_TIMEOUT) ran out — the call itself carried no ` +
          `deadline`;

      this.#reportDelivery({ subject, error });

      return {
        isSuccess: false,
        status: 'TIMEOUT',
        value: {
          error: `Bus request to '${subject}' timed out: ${reason}.`,
          code: DeadlineExceeded.code,
        },
      };
    }

    this.#reportDelivery({ subject, error });

    return {
      isSuccess: false,
      status: 'SERVICE_UNAVAILABLE',
      value: {
        error: `Bus request to '${subject}' failed on the broker.`,
      },
    };
  }

  /** Конверт отправки в заголовках */
  #envelope(
    connection: NatsLike,
    address: string,
    options: RequestOptions | PublishOptions,
  ): ReturnType<NatsLike['headers']> {
    return encodeEnvelope(connection.headers(), address, {
      ...(options.timeoutMs === undefined
        ? {}
        : { timeoutMs: options.timeoutMs }),
      ...('idempotencyKey' in options && options.idempotencyKey !== undefined
        ? { idempotencyKey: options.idempotencyKey }
        : {}),
      ...(options.context === undefined ? {} : { context: options.context }),
    });
  }

  /** Адрес на брокере: имя операции с префиксом окружения */
  #subjectOf(subject: string): string {
    return `${this.#options.subjectPrefix ?? ''}${subject}`;
  }

  #requireConnection(): NatsLike {
    if (!this.#connection) {
      throw new Error(
        'NATS bus has no connection: it is captured in phase 2 INIT. A call ' +
          'this early means the transport was used outside the assembled ' +
          'application — move it to @OnStart or later.',
      );
    }

    return this.#connection;
  }

  #report(info: NatsConnectionInfo): void {
    this.#options.onConnectionChange?.(info);
  }

  #reportDelivery(info: NatsDeliveryFailure): void {
    if (this.#options.onDeliveryFailure) {
      this.#options.onDeliveryFailure(info);

      return;
    }

    // eslint-disable-next-line no-console
    console.error(
      `[nestling] nats delivery failed on '${info.subject}':`,
      info.error,
    );
  }
}

/**
 * Объявляет экземпляр транспорта-шины на NATS.
 *
 * Перечисляется в `transports:` словаря `assemble` — как `http()` и
 * `cli()`. Отдельной оси в корне не появляется: шина это транспорт, и её
 * место там же, где место остальных. Переносчиком операций она становится,
 * когда корень назначит её в `intercom:` — по имени экземпляра.
 *
 * @param options - Явные опции; сильнее конфига, как у HTTP-транспорта
 *
 * @example
 * ```typescript
 * await assemble({
 *   features: [OrdersFeature, BillingFeature],
 *   select: load(RootConfig).features,
 *   transports: [http(), nats({ name: 'events' })],
 *   intercom: 'events',
 *   config: [[dotenv('.env'), natsConfigKeys]],
 * }).run();
 * ```
 */
export const nats = <const Name extends string = typeof DEFAULT_INSTANCE>(
  options: NatsTransportOptions & { readonly name?: Name } = {},
): BusDeclaration<Name> => {
  const { name = DEFAULT_INSTANCE as Name, ...transportOptions } = options;

  return makeTransportDeclaration({
    name,
    bus: true,
    token: BusTransport$,
    provider: factoryProvider(
      BusTransport$,
      (config: NatsConfigValues) =>
        new NatsBus({
          servers: config.servers,
          requestTimeout: config.requestTimeout,
          subjectPrefix: config.subjectPrefix,
          // Явные опции сильнее конфига: спред идёт последним
          ...transportOptions,
        }),
      [NatsConfig as unknown as InjectionToken<NatsConfigValues>],
    ),
  });
};
