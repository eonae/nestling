/**
 * Шина: `IMessageBus` как LCD глаголов брокера и `InProcessBus` как одно
 * значение с двумя способностями.
 *
 * Дихотомия «messaging vs transports» ложная: шина — транспорт с двумя
 * способностями. Inbound: `serve(dispatch, signal)` подписывает маршруты
 * своих реализаций на их subject'ы. Outbound: `request`/`publish` для
 * вызывателей. Ровно та форма, которую примет NATS-транспорт, — поэтому
 * V1-шина не заглушка, а репетиция интерфейса.
 */

import {
  deadlineFromTimeout,
  isExhausted,
  profileAttributes,
  startBudget,
} from './profile.js';
import { failureResponse } from './response.js';
import { BUS_TRANSPORT_NAME, busBindingOf } from './transport.js';
import { structuralCopy } from './wire.js';

import { makeToken } from '@nestling/container';
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
} from '@nestling/pipeline';
import { Topic } from '@nestling/streams';
import type {
  Dispatch,
  ITransport,
  RouteDeclaration,
} from '@nestling/transport';

/** Что известно обработчику о доставленном сообщении */
export interface BusMessageMeta {
  /** Subject, на который пришло сообщение */
  readonly subject: string;

  /** Канал отмены: сигнал вызова, композированный с сигналом остановки */
  readonly signal: AbortSignal;

  /**
   * Бюджет обработки — **абсолютный момент по часам получателя**,
   * пересчитанный из относительного `timeoutMs` конверта в момент приёма.
   * Момент отправителя границу процесса не пересекает.
   */
  readonly deadline?: Date;

  /** Ключ идемпотентности доставленной команды */
  readonly idempotencyKey?: string;

  /**
   * Провозимый контекст: значения ambient-переменных, объявленных
   * `{ propagate: true }`, собранные вызывателем из ячейки его запроса.
   *
   * Часть конверта, а не payload'а: вход контракта провоз не трогает.
   */
  readonly context?: Record<string, unknown>;
}

/**
 * Обработчик сообщения шины.
 *
 * Возвращает контекст ответа для req-reply и ничего — для доставки
 * fire-and-forget.
 */
export type BusHandler = (
  payload: unknown,
  meta: BusMessageMeta,
) => /* eslint-disable-next-line @typescript-eslint/no-invalid-void-type --
 * `void` в union'е возврата осознан: подписчик fire-and-forget пишется
 * обычной функцией без return, и требовать от него `undefined` значило бы
 * ломать поддерживаемую форму (тот же приём, что у юнитов пайплайна) */
Promise<ResponseContext | void> | ResponseContext | void;

/** Опции подписки */
export interface SubscribeOptions {
  /**
   * Группа доставки — in-proc аналог queue-group: сообщение получает ровно
   * один член группы. Подписки без группы независимы, то есть получают
   * каждое сообщение (broadcast).
   */
  group?: string;
}

/**
 * Опции запроса — конверт эксплуатационного профиля.
 *
 * `idempotencyKey` здесь нет: у вида `request` его нет и в `meta` вызова.
 * Конверт описывает то, что бывает, а не декартово произведение полей.
 */
export interface RequestOptions {
  /** Канал отмены вызова */
  signal?: AbortSignal;

  /**
   * Остаток бюджета в миллисекундах, посчитанный **отправителем по своим
   * часам**. Относительный, а не абсолютный, именно ради провода: так
   * рассинхрон часов между процессами на семантику бюджета не влияет.
   */
  timeoutMs?: number;

  /**
   * Провозимый контекст: значения переменных, объявленных
   * `{ propagate: true }`. Едет конвертом, а не payload'ом, — вход
   * контракта провоз не подмешивает.
   */
  context?: Record<string, unknown>;
}

/**
 * Опции публикации — тот же конверт fire-and-forget.
 *
 * `signal` здесь нет: после постановки сообщения отменять нечего.
 */
export interface PublishOptions {
  /** Остаток бюджета **обработчика** в миллисекундах (см. `RequestOptions`) */
  timeoutMs?: number;

  /** Ключ идемпотентности команды: провозится, но не дедуплицируется */
  idempotencyKey?: string;

  /** Провозимый контекст (см. `RequestOptions.context`) */
  context?: Record<string, unknown>;

  /**
   * Долговечная доставка: сообщение обязано пережить простой подписчика.
   *
   * Признак приезжает из контракта — долговечность есть свойство операции,
   * известное обеим сторонам. Слово «JetStream» здесь не появляется: как
   * обслужить признак, решает транспорт, а шина без такой способности
   * (`durable === false`) обслуживает контракт недолговечно и говорит об
   * этом строкой на go-live.
   */
  durable?: boolean;
}

/** Хэндл подписки: единственное, что с ней можно сделать, — снять */
export interface BusSubscription {
  unsubscribe(): void;
}

/**
 * Шина сообщений — наименьший общий знаменатель глаголов брокера.
 *
 * Специфика конкретного брокера (JetStream, ack-семантика,
 * wildcard-subject'ы, KV) за эту границу не протекает: ядро зависит только
 * от интерфейса, реализации — обычные провайдеры.
 *
 * Относительный timeout и ключ идемпотентности — часть LCD, а не вендорская
 * специфика: они есть у любого брокера, а **кодирование** конверта
 * (headers, metadata) остаётся делом транспорта. Иначе первый же настоящий
 * провод потребовал бы менять этот интерфейс, то есть LCD оказался бы не LCD.
 */
export interface IMessageBus {
  /**
   * Доставляет ли шина **за пределы процесса**.
   *
   * Объявляется значением, а не выводится из типа реализации: это вход
   * биндинга вызывателей, и `instanceof InProcessBus` там был бы
   * зависимостью ядра от конкретной реализации. Транспорт знает о себе то,
   * чего не знает композиция, — поэтому признак принадлежит ему.
   */
  readonly remote: boolean;

  /**
   * Умеет ли шина долговечную доставку (`PublishOptions.durable`).
   *
   * Тоже значение: приложение с долговечными контрактами на шине без этой
   * способности стартует — иначе локальный запуск без брокера был бы
   * невозможен, — но деградация печатается строкой на go-live.
   */
  readonly durable: boolean;

  /** Req-reply: ответ приходит от единственного получателя */
  request(
    subject: string,
    payload: unknown,
    options?: RequestOptions,
  ): Promise<ResponseContext>;

  /** Fire-and-forget: резолвится по факту доставки, не обработки */
  publish(
    subject: string,
    payload: unknown,
    options?: PublishOptions,
  ): Promise<void>;

  /** Подписка на subject; `options.group` делит доставку между членами */
  subscribe(
    subject: string,
    handler: BusHandler,
    options?: SubscribeOptions,
  ): BusSubscription;
}

/** Токен шины: ядро зависит от интерфейса, а не от реализации */
export const MessageBus$ = makeToken<IMessageBus>('MessageBus');

/** Опции in-proc шины */
export interface InProcessBusOptions {
  /** Размер буфера на подписчика (см. `Topic`) */
  buffer?: number;

  /**
   * Диагностический хук: отказ доставки (упавший подписчик, отсутствующий
   * получатель). Не задан — рантайм пишет в `console.error`.
   */
  onDeliveryFailure?: (info: { subject: string; error: unknown }) => void;

  /** Диагностический хук стража границы для входящих сообщений */
  onUnknownFail?: (info: UnknownFailInfo) => void;
}

/** Способности шины по формам io: только value с обеих сторон */
const BUS_CAPABILITIES: TransportCapabilities = {
  input: new Set<FormKind>(['value']),
  output: new Set<FormKind>(['value']),
};

/**
 * Копия провозимого контекста — той же процедурой, что payload.
 *
 * Тема это репетиция провода, и контекст пересекает её ровно так же, как
 * пересёк бы NATS: значение, не переживающее копирование, отвергает вызов
 * здесь, а не приезжает получателю ссылкой на объект вызывающего.
 */
function copyContext(
  subject: string,
  context: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  return context === undefined
    ? undefined
    : structuralCopy(context, `Propagated context of '${subject}'`);
}

/** Одна подписка: обработчик и группа доставки, к которой он принадлежит */
interface Entry {
  readonly handler: BusHandler;
  readonly group: string;
}

/**
 * Сообщение в теме subject'а.
 *
 * Профиль едет здесь **относительным** timeout'ом — той же формой, что по
 * проводу: тема это репетиция провода, и абсолютный момент через неё не
 * пересекает границу так же, как не пересёк бы её через NATS.
 */
interface Envelope {
  readonly payload: unknown;
  readonly timeoutMs?: number;
  readonly idempotencyKey?: string;
  readonly context?: Record<string, unknown>;
}

/**
 * Группа доставки: сообщение получает ровно один её член.
 *
 * Насос группы — единственный подписчик темы: буфер и политика медленного
 * подписчика принадлежат `Topic`, круговой выбор члена — группе.
 */
class DeliveryGroup {
  readonly entries: Entry[] = [];

  #cursor = 0;

  /** Насос запущен: повторная подписка члена его не удваивает */
  pumping = false;

  next(): Entry | undefined {
    if (this.entries.length === 0) {
      return undefined;
    }

    const entry = this.entries[this.#cursor % this.entries.length];
    this.#cursor = (this.#cursor + 1) % this.entries.length;

    return entry;
  }
}

/** Всё, что известно об одном subject'е */
class SubjectHub {
  readonly topic: Topic<Envelope>;
  readonly groups = new Map<string, DeliveryGroup>();

  /** Круговой курсор req-reply: реплики владельца делят нагрузку */
  #cursor = 0;

  constructor(
    readonly subject: string,
    buffer?: number,
  ) {
    this.topic = new Topic<Envelope>(buffer === undefined ? {} : { buffer });
  }

  /** Все обработчики subject'а в порядке подписки — получатели req-reply */
  entries(): Entry[] {
    return [...this.groups.values()].flatMap((group) => group.entries);
  }

  /** Следующий получатель req-reply или `undefined`, если их нет */
  nextResponder(): Entry | undefined {
    const entries = this.entries();
    if (entries.length === 0) {
      return undefined;
    }

    const entry = entries[this.#cursor % entries.length];
    this.#cursor = (this.#cursor + 1) % entries.length;

    return entry;
  }
}

/**
 * In-proc шина: `IMessageBus` плюс `ITransport`.
 *
 * Broadcast построен на `Topic` из `@nestling/streams` — с его
 * bounded-буфером и политикой медленного подписчика, поэтому публикация
 * никогда не ждёт обработчика. `durable`-доставки, ретраев и
 * персистентности в V1 нет: без внешнего брокера им негде жить.
 *
 * Конверт профиля реализован целиком — как репетиция провода: относительный
 * `timeoutMs` становится абсолютным моментом **на приёме** по часам
 * получателя, исчерпанный к этому моменту бюджет отвечает
 * `DeadlineExceeded`, не тронув `dispatch.call`, а ключ идемпотентности
 * попадает в транспортные атрибуты рядом с `subject`.
 */
export class InProcessBus implements IMessageBus, ITransport {
  /** Способности транспорта: читает `assertFormsSupported` на сборке */
  readonly capabilities: TransportCapabilities = BUS_CAPABILITIES;

  /**
   * Доставки за пределы процесса у неё нет по построению: тема живёт в
   * куче этого процесса. Отсюда fail-fast недостижимого контракта на
   * сборке — «владельца не выбрали здесь» здесь и означает «владельца нет».
   */
  readonly remote: boolean = false;

  /**
   * Долговечности тоже нет: без внешнего брокера персистентности негде
   * жить, а изобретать её (файл, sqlite, ретраи в памяти) значило бы
   * обещать переживание падения процесса, которого нет.
   */
  readonly durable: boolean = false;

  readonly #hubs = new Map<string, SubjectHub>();

  /** Канал остановки самой шины; композируется с сигналом `serve` */
  readonly #closing = new AbortController();

  /**
   * Канал остановки доставки.
   *
   * Всегда собственный: сигнал приложения `serve` транслирует сюда, а не
   * подменяет — иначе подписки, заведённые на WIRE (до `serve`), остались
   * бы на старом сигнале и пережили бы shutdown.
   */
  readonly #signal: AbortSignal = this.#closing.signal;

  #dispatch?: Dispatch;

  #closed = false;

  constructor(private readonly options: InProcessBusOptions = {}) {}

  /**
   * Подписывает маршруты своих реализаций — шаг фазы WIRE.
   *
   * Отдельно от `serve`, потому что «эфир» и «маршрутизация» у шины
   * разъезжаются во времени: `@OnStart` уже вправе звать порт (гарантия
   * фазовой модели), а `serve` всех транспортов идёт **после** `@OnStart`.
   * Подписка на WIRE закрывает это окно и заодно делает `always-remote`
   * работоспособным в тестовом корне, который до START не доходит вовсе.
   *
   * Идемпотентна: повторный вызов с тем же диспетчером ничего не делает.
   *
   * @param dispatch - Диспетчер транспорта шины, рождённый в WIRE
   */
  attach(dispatch: Dispatch): void {
    if (this.#dispatch === dispatch) {
      return;
    }

    if (this.#dispatch) {
      throw new Error('Bus transport is already routing another dispatch');
    }

    // Формы io — до первой доставки: на standalone-пути это единственная
    // точка проверки, и текст ошибки тот же, что у сборки приложения
    for (const route of dispatch.routes) {
      assertFormsSupported(route, this.capabilities);
    }

    this.#dispatch = dispatch;

    for (const route of dispatch.routes) {
      const binding = busBindingOf(route);
      if (!binding) {
        continue;
      }

      // Адрес подписки: у события — имя подписчика, у запроса и команды
      // владелец один, и его группа общая для всех реплик subject'а
      const group =
        binding.kind === 'event'
          ? (binding.subscriber ?? route.pattern)
          : `owner:${binding.subject}`;

      this.subscribe(
        binding.subject,
        (payload, meta) => this.#execute(route, payload, meta),
        { group },
      );
    }
  }

  /**
   * Выводит шину в эфир.
   *
   * Маршруты к этому моменту уже подписаны (`attach` на WIRE), поэтому
   * здесь остаётся одно: связать сигнал приложения с собственным каналом
   * остановки, чтобы взвод сигнала прекращал доставку так же, как `close()`.
   */
  async serve(dispatch: Dispatch, signal: AbortSignal): Promise<void> {
    this.attach(dispatch);

    if (signal.aborted) {
      this.#closing.abort();

      return;
    }

    signal.addEventListener('abort', () => this.#closing.abort(), {
      once: true,
    });
  }

  /**
   * Req-reply: сообщение уходит ровно одному получателю.
   *
   * Async-барьер безусловен: доставка никогда не синхронна, потому что по
   * проводу она синхронной не бывает. Payload и ответ копируются
   * структурно — это и есть репетиция split'а.
   */
  async request(
    subject: string,
    payload: unknown,
    options: RequestOptions = {},
  ): Promise<ResponseContext> {
    const wire = structuralCopy(payload, `Request to '${subject}'`);
    const context = copyContext(subject, options.context);

    // Барьер: получатель не начинает работу внутри синхронной части вызова
    await Promise.resolve();

    if (this.#closed || this.#signal.aborted) {
      return this.#undeliverable(subject, 'the bus is closed');
    }

    const entry = this.#hubs.get(subject)?.nextResponder();
    if (!entry) {
      return this.#undeliverable(subject, 'no subscriber is listening');
    }

    const signal =
      options.signal === undefined
        ? this.#signal
        : AbortSignal.any([options.signal, this.#signal]);

    // Приём: относительный timeout снова становится моментом — по часам
    // получателя. Точка приёма у req-reply одна, и она здесь
    const deadline = deadlineFromTimeout(options.timeoutMs);

    const response = await entry.handler(wire, {
      subject,
      signal,
      deadline,
      ...(context === undefined ? {} : { context }),
    });

    if (!response) {
      return this.#undeliverable(subject, 'the subscriber returned no reply');
    }

    return structuralCopy(response, `Reply of '${subject}'`);
  }

  /**
   * Fire-and-forget: резолвится по факту постановки сообщения в очереди
   * подписчиков, а не по факту обработки.
   *
   * Бюджет конверта ограничивает **обработчика**, а не ожидание
   * вызывающего: ждать здесь нечего, публикация возвращается сразу.
   */
  async publish(
    subject: string,
    payload: unknown,
    options: PublishOptions = {},
  ): Promise<void> {
    const wire = structuralCopy(payload, `Message to '${subject}'`);
    const context = copyContext(subject, options.context);

    if (this.#closed || this.#signal.aborted) {
      return;
    }

    // `options.durable` здесь читать нечем: долговечности у in-proc шины
    // нет, и признак сознательно игнорируется — вместо тихого «как-нибудь
    // доставится» приложение печатает строку деградации на go-live
    this.#hubs.get(subject)?.topic.push({
      payload: wire,
      timeoutMs: options.timeoutMs,
      idempotencyKey: options.idempotencyKey,
      context,
    });
  }

  /**
   * Подписывает обработчик на subject.
   *
   * Подписки одной группы делят доставку (in-proc queue-group), подписки
   * разных групп получают каждое сообщение.
   */
  subscribe(
    subject: string,
    handler: BusHandler,
    options: SubscribeOptions = {},
  ): BusSubscription {
    const hub = this.#hub(subject);
    const name = options.group ?? `anonymous:${hub.groups.size}`;

    let group = hub.groups.get(name);
    if (!group) {
      group = new DeliveryGroup();
      hub.groups.set(name, group);
    }

    const entry: Entry = { handler, group: name };
    group.entries.push(entry);

    if (!group.pumping) {
      group.pumping = true;
      void this.#pump(hub, group);
    }

    return {
      unsubscribe: () => {
        const index = group.entries.indexOf(entry);
        if (index !== -1) {
          group.entries.splice(index, 1);
        }
      },
    };
  }

  /**
   * Останавливает шину: доставки больше нет, темы закрыты, насосы
   * завершились нормально.
   */
  async close(): Promise<void> {
    this.#closed = true;
    this.#closing.abort();

    for (const hub of this.#hubs.values()) {
      hub.topic.close();
    }
    this.#hubs.clear();
    this.#dispatch = undefined;
  }

  /** Насос группы: единственный подписчик темы, раздающий по кругу */
  async #pump(hub: SubjectHub, group: DeliveryGroup): Promise<void> {
    for await (const envelope of hub.topic.subscribe(this.#signal)) {
      const entry = group.next();
      if (!entry) {
        continue;
      }

      try {
        // Отказ одного подписчика не влияет на доставку остальным: они
        // разбирают свои темы независимо
        await entry.handler(envelope.payload, {
          subject: hub.subject,
          signal: this.#signal,
          // Приём — здесь: бюджет отсчитывается от момента, когда сообщение
          // снято с темы, а не от момента публикации. Ожидание в буфере
          // съедает бюджет ровно так же, как съел бы транзит по проводу
          deadline: deadlineFromTimeout(envelope.timeoutMs),
          idempotencyKey: envelope.idempotencyKey,
          ...(envelope.context === undefined
            ? {}
            : { context: envelope.context }),
        });
      } catch (error) {
        this.#report(hub.subject, error);
      }
    }
  }

  /** Маршрутизирует входящее сообщение в исполнение ручки */
  async #execute(
    route: RouteDeclaration,
    payload: unknown,
    meta: BusMessageMeta,
  ): Promise<ResponseContext> {
    const dispatch = this.#dispatch;

    if (!dispatch) {
      throw new Error(
        'Bus transport is not serving: call serve(dispatch, signal) first.',
      );
    }

    // Fail-fast до обработки: бюджет, исчерпанный в транзите, означает, что
    // ответа уже никто не ждёт — исполнять ручку незачем
    if (isExhausted(meta.deadline)) {
      return failureResponse(DeadlineExceeded());
    }

    const raw: Raw = {
      transport: BUS_TRANSPORT_NAME,
      pattern: route.pattern,
      payload,
      // Профиль — рядом с `subject`: это провод, и он безусловен. Юнит,
      // читающий атрибуты, видит его без всякой композиции. Поля, которых
      // в конверте не было, не появляются и в атрибутах
      attributes: profileAttributes(meta),
    };

    const endpoint: EndpointMeta = {
      transport: BUS_TRANSPORT_NAME,
      pattern: route.pattern,
      input: route.input,
      output: route.output,
      // Объявленные отказы доезжают до стража только так: декларация →
      // транспорт → контекст, без глобального реестра
      errors: route.errors,
    };

    // Живой бюджет композируется с сигналом доставки: кооперативный
    // обработчик видит исчерпание бюджета своим `ctx.signal`
    const budget = startBudget(meta.deadline, meta.signal);
    const ctx = makeEmptyContext(raw, endpoint, budget.signal);

    try {
      return await dispatch.call(route.pattern, ctx, {
        // Через шину stack не уезжает — ровно как не уехал бы по проводу
        exposeErrorDetails: false,
        onUnknownFail: this.options.onUnknownFail,
      });
    } catch (error) {
      // Ручка без pipeline отказ бросает: страж границы живёт в пайплайне,
      // поэтому ответ собирает транспорт — как это делает HTTP
      return failureResponse(error);
    } finally {
      budget.release();
    }
  }

  /** Тема subject'а, заводимая по первой подписке */
  #hub(subject: string): SubjectHub {
    const existing = this.#hubs.get(subject);
    if (existing) {
      return existing;
    }

    const hub = new SubjectHub(subject, this.options.buffer);
    this.#hubs.set(subject, hub);

    return hub;
  }

  /** Ответ на запрос, который некому обслужить */
  #undeliverable(subject: string, reason: string): ResponseContext {
    const error = new Error(
      `Bus request to '${subject}' was not delivered: ${reason}.`,
    );
    this.#report(subject, error);

    return {
      isSuccess: false,
      status: 'SERVICE_UNAVAILABLE',
      value: { error: error.message },
    };
  }

  /** Диагностический канал отказов доставки */
  #report(subject: string, error: unknown): void {
    if (this.options.onDeliveryFailure) {
      this.options.onDeliveryFailure({ subject, error });
      return;
    }

    // eslint-disable-next-line no-console
    console.error(`[nestling] bus delivery failed on '${subject}':`, error);
  }
}
