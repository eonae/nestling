/**
 * Шина сообщений.
 *
 * `IMessageBus` — минимальный интерфейс брокера: только операции, которые
 * есть у любого брокера (`request`, `publish`, `subscribe`). Специфика
 * конкретного брокера (JetStream, ack, wildcard-subject'ы) сюда не входит.
 *
 * `InProcessBus` — реализация шины внутри одного процесса. Она же является
 * транспортом (`ITransport`): в `serve(dispatch, signal)` подписывает
 * маршруты реализаций контрактов на их subject'ы, а через
 * `request`/`publish` отправляет вызовы портов. NATS-транспорт реализует
 * те же два интерфейса, поэтому замена этой шины на брокер не меняет код
 * приложения.
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

/** Метаданные доставленного сообщения, доступные обработчику */
export interface BusMessageMeta {
  /** Subject, на который пришло сообщение */
  readonly subject: string;

  /** Сигнал отмены: объединяет сигнал вызова и сигнал остановки шины */
  readonly signal: AbortSignal;

  /**
   * Момент, до которого нужно обработать сообщение, по часам получателя.
   *
   * Шина вычисляет его из относительного `timeoutMs` конверта в момент
   * приёма. Момент отправителя через границу процесса не передаётся.
   */
  readonly deadline?: Date;

  /** Ключ идемпотентности доставленной команды */
  readonly idempotencyKey?: string;

  /**
   * Переданный контекст: значения ambient-переменных, объявленных с
   * `{ propagate: true }`, которые вызыватель собрал из своего запроса.
   *
   * Это часть конверта, а не payload: во вход контракта они не попадают.
   */
  readonly context?: Record<string, unknown>;
}

/**
 * Обработчик сообщения шины.
 *
 * Для запроса-ответа возвращает контекст ответа, для доставки без ответа
 * не возвращает ничего.
 */
export type BusHandler = (
  payload: unknown,
  meta: BusMessageMeta,
) => /* eslint-disable-next-line @typescript-eslint/no-invalid-void-type --
 * `void` в объединении типов возврата нужен: подписчик без ответа
 * пишется обычной функцией без `return`, и требовать от него `undefined`
 * нельзя. Так же устроены юниты пайплайна. */
Promise<ResponseContext | void> | ResponseContext | void;

/** Опции подписки */
export interface SubscribeOptions {
  /**
   * Группа доставки, аналог queue-group у брокера: сообщение получает
   * ровно один член группы. Подписки без группы независимы и получают
   * каждое сообщение.
   */
  group?: string;
}

/**
 * Опции запроса: параметры вызова, которые передаются вместе с сообщением.
 *
 * `idempotencyKey` здесь нет: у вида `request` его нет и в `meta` вызова.
 */
export interface RequestOptions {
  /** Канал отмены вызова */
  signal?: AbortSignal;

  /**
   * Остаток бюджета в миллисекундах, посчитанный отправителем по своим
   * часам. Через границу процесса передаётся длительность, а не момент,
   * поэтому рассинхрон часов между процессами на бюджет не влияет.
   */
  timeoutMs?: number;

  /**
   * Передаваемый контекст: значения переменных, объявленных с
   * `{ propagate: true }`. Передаётся в конверте, а не в payload: во вход
   * контракта не попадает.
   */
  context?: Record<string, unknown>;
}

/**
 * Опции публикации: параметры доставки без ответа.
 *
 * `signal` здесь нет: после того как сообщение поставлено в очередь,
 * отменять нечего.
 */
export interface PublishOptions {
  /** Остаток бюджета обработчика в миллисекундах (см. `RequestOptions`) */
  timeoutMs?: number;

  /** Ключ идемпотентности команды. Передаётся обработчику без дедупликации */
  idempotencyKey?: string;

  /** Передаваемый контекст (см. `RequestOptions.context`) */
  context?: Record<string, unknown>;

  /**
   * Долговечная доставка: сообщение должно пережить простой подписчика.
   *
   * Значение берётся из контракта: долговечность — свойство операции,
   * известное обеим сторонам. Как её обеспечить, решает транспорт. Шина
   * без такой возможности (`durable === false`) доставляет сообщение
   * обычным способом, а приложение печатает об этом строку при старте.
   */
  durable?: boolean;
}

/** Подписка; единственная операция над ней — отписаться */
export interface BusSubscription {
  unsubscribe(): void;
}

/**
 * Шина сообщений: минимальный общий интерфейс брокера.
 *
 * Специфика конкретного брокера (JetStream, ack, wildcard-subject'ы, KV)
 * в интерфейс не входит: ядро зависит только от него, а реализации —
 * обычные провайдеры. Относительный таймаут и ключ идемпотентности есть у
 * любого брокера, поэтому они входят в интерфейс; как кодировать их в
 * сообщении (headers, metadata), решает транспорт.
 */
export interface IMessageBus {
  /**
   * Доставляет ли шина сообщения за пределы процесса.
   *
   * По этому значению ядро выбирает способ привязки вызывателей. Оно
   * объявляется явно, а не выводится из класса реализации: ядро не должно
   * зависеть от конкретной шины.
   */
  readonly remote: boolean;

  /**
   * Умеет ли шина долговечную доставку (`PublishOptions.durable`).
   *
   * Приложение с долговечными контрактами на шине без этой возможности
   * всё равно стартует, а список таких контрактов печатается при старте.
   */
  readonly durable: boolean;

  /** Запрос-ответ: сообщение получает один подписчик и отвечает на него */
  request(
    subject: string,
    payload: unknown,
    options?: RequestOptions,
  ): Promise<ResponseContext>;

  /** Отправка без ответа: промис разрешается при постановке в очередь */
  publish(
    subject: string,
    payload: unknown,
    options?: PublishOptions,
  ): Promise<void>;

  /** Подписывает обработчик; подписки одной `group` делят сообщения */
  subscribe(
    subject: string,
    handler: BusHandler,
    options?: SubscribeOptions,
  ): BusSubscription;
}

/** Токен шины. Ядро запрашивает по нему `IMessageBus`, а не реализацию */
export const MessageBus$ = makeToken<IMessageBus>('MessageBus');

/** Опции шины внутри процесса */
export interface InProcessBusOptions {
  /** Размер буфера на подписчика (см. `Topic`) */
  buffer?: number;

  /**
   * Хук диагностики: вызывается при отказе доставки (подписчик бросил
   * исключение, получателя нет). Без хука шина пишет в `console.error`.
   */
  onDeliveryFailure?: (info: { subject: string; error: unknown }) => void;

  /** Хук диагностики незадекларированных отказов у входящих сообщений */
  onUnknownFail?: (info: UnknownFailInfo) => void;
}

/** Формы io, которые поддерживает шина: только `value` на входе и выходе */
const BUS_CAPABILITIES: TransportCapabilities = {
  input: new Set<FormKind>(['value']),
  output: new Set<FormKind>(['value']),
};

/**
 * Копирует контекст вызова тем же `structuralCopy`, что и payload.
 *
 * Получатель не должен получить ссылку на объект вызывающего: шина внутри
 * процесса ведёт себя как сетевая. Несериализуемое значение в контексте
 * роняет вызов здесь, а не при первом переходе на NATS.
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
 * Бюджет хранится относительным `timeoutMs`, как при передаче по сети:
 * абсолютный момент через шину не передаётся, получатель вычисляет его сам.
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
 * У группы один подписчик темы — насос (`#pump`), который раздаёт
 * сообщения членам по кругу. Буфер и политика медленного подписчика
 * остаются у `Topic`.
 */
class DeliveryGroup {
  readonly entries: Entry[] = [];

  #cursor = 0;

  /** Насос уже запущен: новый член группы второй насос не создаёт */
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

/** Состояние одного subject'а: тема и группы доставки */
class SubjectHub {
  readonly topic: Topic<Envelope>;
  readonly groups = new Map<string, DeliveryGroup>();

  /** Курсор выбора получателя запроса: реплики владельца чередуются */
  #cursor = 0;

  constructor(
    readonly subject: string,
    buffer?: number,
  ) {
    this.topic = new Topic<Envelope>(buffer === undefined ? {} : { buffer });
  }

  /** Все обработчики subject'а в порядке подписки; получатели запросов */
  entries(): Entry[] {
    return [...this.groups.values()].flatMap((group) => group.entries);
  }

  /** Следующий получатель запроса или `undefined`, если подписчиков нет */
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
 * Шина внутри одного процесса: реализует `IMessageBus` и `ITransport`.
 *
 * Рассылка построена на `Topic` из `@nestling/streams`: у каждого
 * подписчика свой ограниченный буфер, поэтому публикация никогда не ждёт
 * обработчика. Долговечной доставки, повторов и персистентности нет: для
 * них нужен внешний брокер.
 *
 * Параметры вызова обрабатываются так же, как в сетевой шине:
 * относительный `timeoutMs` превращается в момент по часам получателя при
 * приёме, исчерпанный бюджет даёт `DeadlineExceeded` без вызова
 * `dispatch.call`, ключ идемпотентности попадает в транспортные атрибуты
 * рядом с `subject`.
 */
export class InProcessBus implements IMessageBus, ITransport {
  /** Поддерживаемые формы io; их проверяет `assertFormsSupported` на сборке */
  readonly capabilities: TransportCapabilities = BUS_CAPABILITIES;

  /**
   * За пределы процесса шина не доставляет: тема живёт в памяти этого
   * процесса. Поэтому контракт без реализации в этой сборке — ошибка
   * сборки, а не ошибка доставки.
   */
  readonly remote: boolean = false;

  /**
   * Долговечной доставки нет: без внешнего брокера сообщения не переживают
   * падение процесса.
   */
  readonly durable: boolean = false;

  readonly #hubs = new Map<string, SubjectHub>();

  /** Контроллер остановки шины; `serve` связывает с ним сигнал приложения */
  readonly #closing = new AbortController();

  /**
   * Сигнал остановки доставки.
   *
   * Всегда собственный: `serve` не подменяет его сигналом приложения, а
   * транслирует. Иначе подписки, созданные на фазе WIRE до `serve`,
   * остались бы на старом сигнале и пережили бы остановку.
   */
  readonly #signal: AbortSignal = this.#closing.signal;

  #dispatch?: Dispatch;

  #closed = false;

  constructor(private readonly options: InProcessBusOptions = {}) {}

  /**
   * Подписывает маршруты реализаций контрактов на их subject'ы. Вызывается
   * на фазе WIRE.
   *
   * Отделён от `serve`, потому что порт можно вызывать уже из `@OnStart`,
   * а `serve` всех транспортов идёт после `@OnStart`. Подписка на WIRE
   * закрывает это окно; заодно она делает `always-remote` рабочим в
   * тестовой сборке, которая до START не доходит.
   *
   * Повторный вызов с тем же `dispatch` ничего не делает.
   *
   * @param dispatch - `dispatch` транспорта шины, созданный на фазе WIRE
   */
  attach(dispatch: Dispatch): void {
    if (this.#dispatch === dispatch) {
      return;
    }

    if (this.#dispatch) {
      throw new Error('Bus transport is already routing another dispatch');
    }

    // Формы io проверяются до первой доставки: без `assemble` это
    // единственная точка проверки, текст ошибки тот же, что при сборке
    for (const route of dispatch.routes) {
      assertFormsSupported(route, this.capabilities);
    }

    this.#dispatch = dispatch;

    for (const route of dispatch.routes) {
      const binding = busBindingOf(route);
      if (!binding) {
        continue;
      }

      // Группа доставки: у события — имя подписчика; у запроса и команды
      // владелец один, и все его реплики входят в одну группу
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
   * Запускает шину как транспорт.
   *
   * Маршруты к этому моменту уже подписаны (`attach` на фазе WIRE), поэтому
   * здесь остаётся связать сигнал приложения с собственным контроллером
   * остановки: срабатывание сигнала прекращает доставку так же, как
   * `close()`.
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
   * Отправляет запрос одному получателю и возвращает его ответ.
   *
   * Доставка всегда асинхронна, а payload и ответ копируются структурно:
   * шина внутри процесса ведёт себя так же, как сетевая.
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

    // Момент приёма: относительный timeout превращается в момент по часам
    // получателя
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
   * Публикует сообщение без ожидания ответа.
   *
   * Промис разрешается, когда сообщение поставлено в очереди подписчиков,
   * а не когда обработано. Бюджет конверта ограничивает обработчика, а не
   * вызывающего.
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

    // `options.durable` игнорируется: долговечной доставки у этой шины
    // нет. О таких контрактах приложение печатает строку при старте
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

  /** Насос группы: единственный подписчик темы, раздаёт сообщения по кругу */
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
          // Момент приёма — здесь: бюджет отсчитывается от момента, когда
          // сообщение снято с темы, а не от публикации. Ожидание в буфере
          // расходует бюджет так же, как передача по сети
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

  /** Выполняет endpoint маршрута по входящему сообщению */
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

    // Бюджет, исчерпанный в пути, означает, что ответа уже никто не ждёт:
    // endpoint не выполняется
    if (isExhausted(meta.deadline)) {
      return failureResponse(DeadlineExceeded());
    }

    const raw: Raw = {
      transport: BUS_TRANSPORT_NAME,
      pattern: route.pattern,
      payload,
      // Параметры вызова кладутся в атрибуты рядом с `subject`; юнит
      // читает их без дополнительных слоёв. Полей, которых не было в
      // конверте, в атрибутах тоже нет
      attributes: profileAttributes(meta),
    };

    const endpoint: EndpointMeta = {
      transport: BUS_TRANSPORT_NAME,
      pattern: route.pattern,
      input: route.input,
      output: route.output,
      // Объявленные отказы попадают в проверку ответа через контекст:
      // декларация передаёт их транспорту, транспорт кладёт сюда
      errors: route.errors,
    };

    // Бюджет объединяется с сигналом доставки: обработчик видит его
    // исчерпание через свой `ctx.signal`
    const budget = startBudget(meta.deadline, meta.signal);
    const ctx = makeEmptyContext(raw, endpoint, budget.signal);

    try {
      return await dispatch.call(route.pattern, ctx, {
        // Стек исключения через шину не передаётся, как и по сети
        exposeErrorDetails: false,
        onUnknownFail: this.options.onUnknownFail,
      });
    } catch (error) {
      // Endpoint без пайплайна бросает отказ: проверка ответа живёт в
      // пайплайне, поэтому ответ собирает транспорт, как и HTTP
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

  /** Сообщает об отказе доставки: в хук `onDeliveryFailure` или в консоль */
  #report(subject: string, error: unknown): void {
    if (this.options.onDeliveryFailure) {
      this.options.onDeliveryFailure({ subject, error });
      return;
    }

    // eslint-disable-next-line no-console
    console.error(`[nestling] bus delivery failed on '${subject}':`, error);
  }
}
