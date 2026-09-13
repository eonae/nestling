/**
 * `NatsBus` — шина приложения на брокере: снаружи `IMessageBus`, изнутри
 * `ITransport`.
 *
 * Использует ту же форму и тот же DI-токен (`BusTransport$`), что и
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
import {
  decodeEnvelope,
  decodeReply,
  encodeEnvelope,
  encodeReply,
  jsonCodec,
} from './wire.js';

import type {
  BusDeclaration,
  BusHandler,
  BusMessageMeta,
  BusSubscription,
  ConfigProjection,
  Dispatch,
  EndpointMeta,
  FormKind,
  IMessageBus,
  ITransport,
  Logger,
  PublishOptions,
  Raw,
  RequestOptions,
  ResponseContext,
  RouteDeclaration,
  SubscribeOptions,
  TransportCapabilities,
} from '@nestlingjs/app';
import {
  assertFormsSupported,
  BUS_TRANSPORT_NAME,
  busBindingOf,
  BusTransport$,
  deadlineFromTimeout,
  DEFAULT_INSTANCE,
  failureResponse,
  InternalError,
  isExhausted,
  Logger$,
  makeEmptyContext,
  makeTransportDeclaration,
  profileAttributes,
  startBudget,
  Timeout,
} from '@nestlingjs/app';
import type { InjectionToken } from '@nestlingjs/container';
import { resourceProvider } from '@nestlingjs/container';

/** Проекция конфиг-секции транспорта — то, что инжектится в фабрику */
type NatsConfigValues = ConfigProjection<typeof NatsConfig>;

/**
 * Способности шины по формам io: только value с обеих сторон.
 *
 * Те же, что у in-proc шины, и по той же причине: стриминг по шине вне V1,
 * и объявлять способность, которой нет, транспорт не станет. Константа
 * пакета: её кладёт в объявление `nats()`, её же читает `attach`.
 */
export const BUS_CAPABILITIES: TransportCapabilities = {
  input: new Set<FormKind>(['value']),
  output: new Set<FormKind>(['value']),
};

/** Лимит попыток durable-доставки: умолчание, словарём не открывается */
const DEFAULT_MAX_DELIVER = 5;

/**
 * Окно дедупликации потока по умолчанию — пять минут.
 *
 * Окно обязано перекрывать цикл повторов relay outbox'а: пока запись не
 * отмечена опубликованной, relay возвращается к ней снова. По умолчаниям
 * секции `outbox` цикл занимает около 122 секунд (`backoffMs` 500,
 * удвоение, потолок `backoffMaxMs` 30 000, `maxAttempts` 10). Умолчание
 * JetStream — две минуты, то есть впритык, а пять минут дают запас в два с
 * половиной раза.
 */
const DEFAULT_DEDUPE_WINDOW_MS = 5 * 60 * 1000;

/** Окно потока задаётся в наносекундах: единица брокера, не наша */
const NANOSECONDS_PER_MS = 1_000_000;

/**
 * Проверяет, что обработка завершилась решением.
 *
 * Решение — это успех или любой отказ с кодом, кроме `internal_error`. Код
 * `internal_error` означает, что решения не получилось: в него необработанное
 * исключение превращает проверка на границе пайплайна.
 */
function isSettled(response: ResponseContext): boolean {
  return (
    response.isSuccess ||
    (response.value?.code !== undefined &&
      response.value.code !== InternalError.code)
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

  /**
   * Окно дедупликации потоков собственного создания, в миллисекундах.
   *
   * Повтор публикации с тем же ключом идемпотентности внутри окна брокер
   * снимает сам: сообщение не попадает в поток и не доходит до
   * подписчика. Умолчание — 5 минут, и оно выбрано по циклу повторов
   * relay outbox'а: тот занимает около 122 секунд по умолчаниям секции
   * `outbox`.
   *
   * Значение `0` выключает дедупликацию: поле в определении потока не
   * задаётся, окно существующего потока не сверяется.
   *
   * Поток, созданный не транспортом, окна не получает: транспорт чужие
   * потоки не переписывает, а о расхождении пишет `warn`.
   */
  dedupeWindowMs?: number;

  /**
   * Хук смены состояния соединения.
   *
   * Это событие для приложения, а не канал вывода: без хука транспорт
   * ничего не пишет.
   */
  onConnectionChange?: (info: NatsConnectionInfo) => void;
}

/**
 * Опции экземпляра шины: опции транспорта плюс логгер.
 *
 * Логгер обязателен: отказ доставки не должен проглатываться молча.
 * Фабрика `nats()` передаёт `Logger$('nestling:nats')`; прямой
 * `new NatsBus(...)` в тестах передаёт свой.
 */
export interface NatsBusOptions extends NatsTransportOptions {
  /** Логгер отказов доставки: записи `error` с `subject` и оригиналом в `err` */
  logger: Logger;
}

/**
 * Шина приложения на NATS.
 *
 * Регистрируется фабрикой {@link nats} под DI-токеном `BusTransport$` — тем
 * же, которым пользуется in-proc шина. Ни одна декларация `implement(...)`,
 * ни одна операция и ни один call-site при подключении не меняются: это и
 * есть уровень L4.
 */
export class NatsBus implements IMessageBus, ITransport {
  /** Доставляет за пределы процесса — вход биндинга вызывателей */
  readonly remote = true;

  /** Умеет долговечную доставку: под ней JetStream */
  readonly durable = true;

  readonly #options: NatsTransportOptions;
  readonly #codec: NatsCodec;
  readonly #closing = new AbortController();

  readonly #logger: Logger;

  /** Потоки, о чьём узком окне уже сказано: запись `warn` одна на поток */
  readonly #dedupeWarned = new Set<string>();

  #connection?: NatsLike;
  #dispatch?: Dispatch;
  #subscriptions: NatsSubscriptionLike[] = [];
  #closed = false;

  constructor(options: NatsBusOptions) {
    this.#options = options;
    this.#logger = options.logger;
    this.#codec = options.codec ?? jsonCodec;
  }

  /**
   * Захватывает соединение — фаза INIT.
   *
   * Соединение это ресурс: объявление `nats()` регистрирует шину
   * провайдером ресурса, и захват завершается раньше, чем выполнится
   * первый `@OnStart`. Вызов порта из `@OnStart` уходит на брокер.
   */
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
      assertFormsSupported(route, BUS_CAPABILITIES);
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

      return decodeReply(this.#codec.decode(reply.data));
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

      const ack = await connection
        .jetstream()
        .publish(address, data, { headers });

      if (ack.duplicate) {
        // Событие редкое и означает, что окно сработало: повтор публикации
        // не попал в поток и до подписчика не дойдёт
        this.#logger.debug('nats publish deduplicated by stream window', {
          subject: address,
        });
      }

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
        msg.respond(this.#codec.encode(encodeReply(response)));
      }
    } catch (error) {
      this.#reportDelivery({ subject: msg.subject, error });

      // Ждущему ответа отказ передаётся значением. Fire-and-forget
      // адреса ответа не имеет, и там отчёт хуку — весь доступный канал
      msg.respond(this.#codec.encode(encodeReply(failureResponse(error))));
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
    const windowMs = this.#options.dedupeWindowMs ?? DEFAULT_DEDUPE_WINDOW_MS;

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
            `the operation or fix the stream — the transport will not rewrite ` +
            `a stream it did not define.`,
        );
      }

      this.#checkDedupeWindow(name, existing.duplicate_window, windowMs);

      return name;
    }

    await manager.streams.add({
      name,
      subjects: [address],
      // Ноль выключает дедупликацию: поле не задаётся вовсе, и поток
      // берёт умолчание сервера
      ...(windowMs > 0
        ? { duplicate_window: windowMs * NANOSECONDS_PER_MS }
        : {}),
    });

    return name;
  }

  /**
   * Сверяет окно существующего потока с настроенным.
   *
   * Окно уже поднятого потока транспорт не переписывает: retention,
   * storage и лимиты — зона эксплуатации. Узкое окно означает сегодняшнее
   * поведение, которое закрывает слой приёма, поэтому расхождение даёт
   * запись `warn`, а не отказ сборки.
   *
   * Запись идёт один раз на поток: `#ensureStream` вызывается на каждой
   * долговечной публикации, и без памяти предупреждение шло бы на каждое
   * сообщение.
   */
  #checkDedupeWindow(
    stream: string,
    actualNanos: number | undefined,
    windowMs: number,
  ): void {
    if (windowMs === 0 || this.#dedupeWarned.has(stream)) {
      return;
    }

    const actualMs = Math.trunc((actualNanos ?? 0) / NANOSECONDS_PER_MS);

    if (actualMs >= windowMs) {
      return;
    }

    this.#dedupeWarned.add(stream);
    this.#logger.warn('nats stream dedupe window is narrower than configured', {
      stream,
      configuredMs: windowMs,
      actualMs,
    });
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
      return failureResponse(Timeout());
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
      // Объявленные исходы едут тем же путём: статус ответа шина несёт как
      // есть, а рантайм сверяет его по ним
      status: route.status,
      errors: route.errors,
    };

    const budget = startBudget(meta.deadline, meta.signal);
    const ctx = makeEmptyContext(raw, endpoint, budget.signal);

    try {
      return await dispatch.call(route.pattern, ctx, {
        // По сети stack не передаётся
        exposeErrorDetails: false,
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
        status: 'service_unavailable',
        value: {
          error:
            `Bus request to '${subject}' was not delivered: no responders ` +
            `are listening on the broker.`,
          code: 'service_unavailable',
        },
      };
    }

    if (code === 'timeout') {
      // Ответ — тот же `timeout`, что дал бы бюджет: множество
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
        status: 'timeout',
        value: {
          error: `Bus request to '${subject}' timed out: ${reason}.`,
          code: Timeout.code,
        },
      };
    }

    this.#reportDelivery({ subject, error });

    return {
      isSuccess: false,
      status: 'service_unavailable',
      value: {
        error: `Bus request to '${subject}' failed on the broker.`,
        code: 'service_unavailable',
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
      // Публикация через поток несёт вдобавок заголовок брокера: конверт
      // долговечной публикации отличается от core-публикации только им
      ...('durable' in options && options.durable === true
        ? { durable: true }
        : {}),
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
          'this early means the transport was used outside the built ' +
          'application — move it to @OnStart or later.',
      );
    }

    return this.#connection;
  }

  #report(info: NatsConnectionInfo): void {
    this.#options.onConnectionChange?.(info);
  }

  #reportDelivery(info: NatsDeliveryFailure): void {
    this.#logger.error('nats delivery failed', {
      subject: info.subject,
      ...(info.terminated === undefined ? {} : { terminated: info.terminated }),
      err: info.error,
    });
  }
}

/**
 * Объявляет экземпляр транспорта-шины на NATS.
 *
 * Перечисляется в `transports:` словаря `build` — как `http()` и
 * `cli()`. Отдельной оси в корне не появляется: шина это транспорт, и её
 * место там же, где место остальных. Переносчиком операций она становится,
 * когда корень назначит её в `intercom:` — по имени экземпляра.
 *
 * @param options - Явные опции; сильнее конфига, как у HTTP-транспорта
 *
 * @example
 * ```typescript
 * await build({
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
    capabilities: BUS_CAPABILITIES,
    provider: resourceProvider(BusTransport$, {
      deps: [
        NatsConfig as unknown as InjectionToken<NatsConfigValues>,
        Logger$('nestling:nats'),
      ] as const,
      acquire: async (config: NatsConfigValues, logger: Logger) => {
        const bus = new NatsBus({
          servers: config.servers,
          requestTimeout: config.requestTimeout,
          subjectPrefix: config.subjectPrefix,
          // Явные опции сильнее конфига: спред идёт последним
          ...transportOptions,
          logger,
        });

        await bus.connect();

        return bus;
      },
      release: (bus: ITransport) => bus.close?.(),
    }),
  });
};
