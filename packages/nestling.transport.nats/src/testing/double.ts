/**
 * In-memory двойник брокера — шов тестируемости пакета.
 *
 * Моделирует ровно ту семантику, на которую опирается транспорт: subject'ы
 * и wildcard-матчинг, queue-группы, req-reply с отказом «никто не слушает»,
 * headers и минимальный JetStream (поток, durable-потребитель, ack/nak,
 * повторная доставка).
 *
 * Ограничение называется прямо и не смягчается: двойник проверяет **наш
 * код**, а не совместимость с брокером. За совместимость отвечает
 * интеграционный прогон против живого `nats-server`
 * (`NATS_TEST_SERVERS`), и гонять его нужно перед публикацией пакета.
 */

import type {
  NatsConsumerConfigLike,
  NatsHeadersLike,
  NatsJetStreamLike,
  NatsJetStreamManagerLike,
  NatsJsMsgLike,
  NatsLike,
  NatsMsgLike,
  NatsPubAckLike,
  NatsStreamConfigLike,
  NatsSubscriptionLike,
  NatsSubscriptionOptions,
} from '../connector.js';

/** Коды отказов клиента `nats` — двойник обязан говорить теми же */
export const NATS_NO_RESPONDERS = '503';
export const NATS_TIMEOUT = 'timeout';
export const NATS_CONNECTION_CLOSED = 'CONNECTION_CLOSED';

/** Отказ брокера: код тот же, что у настоящего клиента */
export class NatsDoubleError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'NatsError';
  }
}

/** Заголовки: обычная карта, регистронезависимая — как у брокера */
export class HeadersDouble implements NatsHeadersLike {
  readonly #values = new Map<string, string>();

  get(key: string): string {
    return this.#values.get(key.toLowerCase()) ?? '';
  }

  set(key: string, value: string): void {
    this.#values.set(key.toLowerCase(), value);
  }

  has(key: string): boolean {
    return this.#values.has(key.toLowerCase());
  }

  keys(): Iterable<string> {
    return [...this.#values.keys()];
  }
}

/**
 * Матчинг subject'а по паттерну NATS.
 *
 * `*` — ровно один токен, `>` — один и более хвостовых. Брокерская
 * способность, которую in-proc шина не эмулирует: там subject трактуется
 * буквально, и это документировано, а не подделано.
 */
export function subjectMatches(pattern: string, subject: string): boolean {
  const patternTokens = pattern.split('.');
  const subjectTokens = subject.split('.');

  for (const [index, token] of patternTokens.entries()) {
    if (token === '>') {
      return index < subjectTokens.length;
    }

    if (index >= subjectTokens.length) {
      return false;
    }

    if (token !== '*' && token !== subjectTokens[index]) {
      return false;
    }
  }

  return patternTokens.length === subjectTokens.length;
}

/** Очередь с ожиданием: подписка отдаёт сообщения асинхронным итератором */
class AsyncQueue<T> {
  readonly #items: T[] = [];
  #waiters: ((value: IteratorResult<T>) => void)[] = [];
  #closed = false;

  push(item: T): void {
    if (this.#closed) {
      return;
    }

    const waiter = this.#waiters.shift();

    if (waiter) {
      waiter({ done: false, value: item });
      return;
    }

    this.#items.push(item);
  }

  close(): void {
    this.#closed = true;

    for (const waiter of this.#waiters) {
      waiter({ done: true, value: undefined as never });
    }
    this.#waiters = [];
  }

  async next(): Promise<IteratorResult<T>> {
    const item = this.#items.shift();

    if (item !== undefined) {
      return { done: false, value: item };
    }

    if (this.#closed) {
      return { done: true, value: undefined as never };
    }

    return await new Promise<IteratorResult<T>>((resolve) => {
      this.#waiters.push(resolve);
    });
  }
}

/** Сообщение, доставленное core-подпиской */
/** Ответ req-reply: тело и заголовки ответного сообщения */
type ReplyFn = (
  data?: Uint8Array,
  options?: { headers?: NatsHeadersLike },
) => void;

class MsgDouble implements NatsMsgLike {
  constructor(
    readonly subject: string,
    readonly data: Uint8Array,
    readonly headers: NatsHeadersLike | undefined,
    readonly reply: ReplyFn | undefined,
  ) {}

  respond(data?: Uint8Array, options?: { headers?: NatsHeadersLike }): boolean {
    if (!this.reply) {
      return false;
    }

    this.reply(data, options);

    return true;
  }
}

/** Одна core-подписка двойника */
class SubscriptionDouble implements NatsSubscriptionLike {
  readonly queue = new AsyncQueue<NatsMsgLike>();

  constructor(
    readonly pattern: string,
    readonly group: string,
    readonly callback:
      | ((error: Error | null, msg: NatsMsgLike) => void)
      | undefined,
    private readonly detach: (subscription: SubscriptionDouble) => void,
  ) {}

  deliver(msg: NatsMsgLike): void {
    if (this.callback) {
      this.callback(null, msg);
      return;
    }

    this.queue.push(msg);
  }

  unsubscribe(): void {
    this.detach(this);
    this.queue.close();
  }

  async drain(): Promise<void> {
    this.unsubscribe();
  }

  [Symbol.asyncIterator](): AsyncIterator<NatsMsgLike> {
    return { next: () => this.queue.next() };
  }
}

/** Сообщение потока: то же плюс подтверждения */
class JsMsgDouble implements NatsJsMsgLike {
  constructor(
    readonly subject: string,
    readonly data: Uint8Array,
    readonly headers: NatsHeadersLike | undefined,
    readonly redeliveryCount: number,
    private readonly settle: (verdict: 'ack' | 'nak' | 'term') => void,
  ) {}

  respond(): boolean {
    return false;
  }

  ack(): void {
    this.settle('ack');
  }

  nak(): void {
    this.settle('nak');
  }

  term(): void {
    this.settle('term');
  }
}

/** Запись потока */
interface StoredMessage {
  readonly subject: string;
  readonly data: Uint8Array;
  readonly headers?: NatsHeadersLike;
}

/** Поток JetStream: определение плюс записанные сообщения */
interface StreamState {
  config: NatsStreamConfigLike;
  readonly messages: StoredMessage[];
  readonly consumers: Map<string, ConsumerState>;
}

/** Durable-потребитель: курсор по потоку плюс очередь повторов */
interface ConsumerState {
  readonly config: NatsConsumerConfigLike;
  cursor: number;
  /** Индексы, ожидающие повторной доставки */
  readonly redelivery: number[];
  /** Индекс → сколько раз доставлялся */
  readonly attempts: Map<number, number>;
  /** Индексы, отданные потребителю и ещё не решённые */
  readonly inFlight: Set<number>;
  /** Проснуться, когда в потоке появилось новое сообщение */
  wake?: () => void;
}

/** Лимит попыток durable-доставки — умолчание двойника и транспорта */
export const DEFAULT_MAX_DELIVER = 5;

/**
 * Двойник брокера: **общее** состояние кластера.
 *
 * Соединения к нему заводятся отдельными значениями
 * ({@link NatsDouble.connection}), потому что дренаж одного процесса не
 * закрывает брокер остальным — а именно на этом различии стоит вся проверка
 * split-развёртывания: два процесса живут на одном брокере и умирают
 * независимо.
 *
 * Сам брокер тоже реализует `NatsLike` — как «нулевое» соединение, которым
 * тесту удобно смотреть на кластер снаружи.
 */
export class NatsDouble implements NatsLike {
  readonly #subscriptions: SubscriptionDouble[] = [];
  readonly #cursors = new Map<string, number>();
  readonly #streams = new Map<string, StreamState>();

  #anonymous = 0;

  /** Что публиковалось: наблюдаемость для тестов транспорта */
  readonly published: { subject: string; headers?: NatsHeadersLike }[] = [];

  headers(): NatsHeadersLike {
    return new HeadersDouble();
  }

  /** Заводит соединение к этому брокеру — то, что видит один процесс */
  connection(): NatsLike {
    return new ConnectionDouble(this);
  }

  publish(
    subject: string,
    data: Uint8Array,
    options: { headers?: NatsHeadersLike } = {},
  ): void {
    this.published.push({
      subject,
      ...(options.headers ? { headers: options.headers } : {}),
    });

    this.#deliver(subject, data, options.headers);
  }

  async request(
    subject: string,
    data: Uint8Array,
    options: { timeout: number; headers?: NatsHeadersLike },
  ): Promise<NatsMsgLike> {
    this.published.push({
      subject,
      ...(options.headers ? { headers: options.headers } : {}),
    });

    return await new Promise<NatsMsgLike>((resolve, reject) => {
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        reject(
          new NatsDoubleError(
            NATS_TIMEOUT,
            `TIMEOUT: no reply on '${subject}'`,
          ),
        );
      }, options.timeout);
      timer.unref?.();

      const reply: ReplyFn = (payload, replyOptions): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(
          new MsgDouble(
            subject,
            payload ?? new Uint8Array(),
            replyOptions?.headers,
            undefined,
          ),
        );
      };

      const delivered = this.#deliver(subject, data, options.headers, reply);

      if (delivered === 0) {
        settled = true;
        clearTimeout(timer);
        reject(
          new NatsDoubleError(
            NATS_NO_RESPONDERS,
            `503: no responders for '${subject}'`,
          ),
        );
      }
    });
  }

  subscribe(
    subject: string,
    options: NatsSubscriptionOptions = {},
  ): NatsSubscriptionLike {
    const group = options.queue ?? `anonymous:${this.#anonymous++}`;
    const subscription = new SubscriptionDouble(
      subject,
      group,
      options.callback,
      (target) => {
        const index = this.#subscriptions.indexOf(target);

        if (index !== -1) {
          this.#subscriptions.splice(index, 1);
        }
      },
    );

    this.#subscriptions.push(subscription);

    return subscription;
  }

  jetstream(alive: () => boolean = () => true): NatsJetStreamLike {
    return {
      publish: async (subject, data, options = {}) =>
        this.#jsPublish(subject, data, options.headers),
      subscribe: async (subject, { stream, durable }) =>
        this.#consume(stream, durable, subject, alive),
    };
  }

  async jetstreamManager(): Promise<NatsJetStreamManagerLike> {
    return {
      streams: {
        add: async (config) => this.#addStream(config),
        info: async (name) => {
          const stream = this.#streams.get(name);

          if (!stream) {
            throw new NatsDoubleError('404', `stream not found: ${name}`);
          }

          return { config: stream.config };
        },
      },
      consumers: {
        add: async (stream, config) => this.#addConsumer(stream, config),
      },
    };
  }

  async drain(): Promise<void> {
    for (const subscription of this.#subscriptions) {
      subscription.unsubscribe();
    }

    this.releaseInFlight();
  }

  async closed(): Promise<void> {
    /* брокер живёт всё время теста */
  }

  /**
   * Возвращает неподтверждённые сообщения в поток.
   *
   * Ровно то, чем durable-доставка отличается от core: процесс, умерший с
   * сообщением в работе, его не теряет — сообщение достаётся другой
   * реплике.
   */
  releaseInFlight(consumers?: ReadonlySet<string>): void {
    for (const stream of this.#streams.values()) {
      for (const [name, consumer] of stream.consumers) {
        if (consumers && !consumers.has(`${stream.config.name}/${name}`)) {
          continue;
        }

        for (const index of consumer.inFlight) {
          consumer.redelivery.push(index);
        }
        consumer.inFlight.clear();
        consumer.wake?.();
      }
    }
  }

  /** Доставляет сообщение всем группам, чьи паттерны совпали */
  #deliver(
    subject: string,
    data: Uint8Array,
    headers: NatsHeadersLike | undefined,
    reply?: ReplyFn,
  ): number {
    const matched = this.#subscriptions.filter((subscription) =>
      subjectMatches(subscription.pattern, subject),
    );

    if (matched.length === 0) {
      return 0;
    }

    // Группировка по паре «паттерн + очередь»: члены одной группы делят
    // сообщение, разные группы получают по копии
    const groups = new Map<string, SubscriptionDouble[]>();

    for (const subscription of matched) {
      const key = `${subscription.pattern}|${subscription.group}`;
      const members = groups.get(key) ?? [];
      members.push(subscription);
      groups.set(key, members);
    }

    for (const [key, members] of groups) {
      const cursor = this.#cursors.get(key) ?? 0;
      this.#cursors.set(key, cursor + 1);

      members[cursor % members.length].deliver(
        new MsgDouble(subject, data, headers, reply),
      );
    }

    return groups.size;
  }

  /** Публикация в поток: сохранение плюс обычная core-доставка */
  #jsPublish(
    subject: string,
    data: Uint8Array,
    headers: NatsHeadersLike | undefined,
  ): NatsPubAckLike {
    this.published.push({ subject, ...(headers ? { headers } : {}) });

    const stream = [...this.#streams.values()].find((candidate) =>
      candidate.config.subjects.some((pattern) =>
        subjectMatches(pattern, subject),
      ),
    );

    if (!stream) {
      throw new NatsDoubleError(
        '503',
        `no stream matches subject '${subject}'`,
      );
    }

    const seq = stream.messages.push({
      subject,
      data,
      ...(headers ? { headers } : {}),
    });

    for (const consumer of stream.consumers.values()) {
      consumer.wake?.();
    }

    this.#deliver(subject, data, headers);

    return { stream: stream.config.name, seq };
  }

  #addStream(config: NatsStreamConfigLike): NatsStreamConfigLike {
    const existing = this.#streams.get(config.name);

    if (existing) {
      return existing.config;
    }

    this.#streams.set(config.name, {
      config,
      messages: [],
      consumers: new Map(),
    });

    return config;
  }

  #addConsumer(
    stream: string,
    config: NatsConsumerConfigLike,
  ): NatsConsumerConfigLike {
    const state = this.#streams.get(stream);

    if (!state) {
      throw new NatsDoubleError('404', `stream not found: ${stream}`);
    }

    const existing = state.consumers.get(config.durable_name);

    if (existing) {
      return existing.config;
    }

    state.consumers.set(config.durable_name, {
      config,
      cursor: 0,
      redelivery: [],
      attempts: new Map(),
      inFlight: new Set(),
    });

    return config;
  }

  /** Итератор durable-потребителя: сперва повторы, потом новые записи */
  #consume(
    stream: string,
    durable: string,
    filter: string,
    alive: () => boolean,
  ): AsyncIterable<NatsJsMsgLike> {
    const state = this.#streams.get(stream);
    const consumer = state?.consumers.get(durable);

    if (!state || !consumer) {
      throw new NatsDoubleError(
        '404',
        `consumer not found: ${stream}/${durable}`,
      );
    }

    const maxDeliver = consumer.config.max_deliver ?? DEFAULT_MAX_DELIVER;

    const nextIndex = (): number | undefined => {
      const redelivered = consumer.redelivery.shift();

      if (redelivered !== undefined) {
        return redelivered;
      }

      while (consumer.cursor < state.messages.length) {
        const index = consumer.cursor++;

        if (subjectMatches(filter, state.messages[index].subject)) {
          return index;
        }
      }

      return undefined;
    };

    return {
      async *[Symbol.asyncIterator](): AsyncIterator<NatsJsMsgLike> {
        while (alive()) {
          const index = nextIndex();

          if (index === undefined) {
            await new Promise<void>((resolve) => {
              consumer.wake = resolve;
            });
            consumer.wake = undefined as never;
            continue;
          }

          const attempts = (consumer.attempts.get(index) ?? 0) + 1;
          consumer.attempts.set(index, attempts);
          consumer.inFlight.add(index);

          const stored = state.messages[index];

          yield new JsMsgDouble(
            stored.subject,
            stored.data,
            stored.headers,
            attempts,
            (verdict) => {
              consumer.inFlight.delete(index);

              if (verdict === 'nak' && attempts < maxDeliver) {
                consumer.redelivery.push(index);
                consumer.wake?.();
              }
            },
          );
        }
      },
    };
  }
}

/**
 * Соединение к двойнику: собственные подписки и собственный дренаж.
 *
 * Ровно то, чем один процесс отличается от кластера: он снимает **свои**
 * подписки, возвращает в поток **свои** неподтверждённые сообщения и
 * отказывает в глаголах после `drain()` — а брокер продолжает жить.
 */
class ConnectionDouble implements NatsLike {
  readonly #subscriptions: NatsSubscriptionLike[] = [];
  readonly #consumers = new Set<string>();

  #closed = false;

  constructor(private readonly broker: NatsDouble) {}

  headers(): NatsHeadersLike {
    return this.broker.headers();
  }

  publish(
    subject: string,
    data: Uint8Array,
    options: { headers?: NatsHeadersLike } = {},
  ): void {
    this.#assertOpen();
    this.broker.publish(subject, data, options);
  }

  async request(
    subject: string,
    data: Uint8Array,
    options: { timeout: number; headers?: NatsHeadersLike },
  ): Promise<NatsMsgLike> {
    this.#assertOpen();

    return await this.broker.request(subject, data, options);
  }

  subscribe(
    subject: string,
    options: NatsSubscriptionOptions = {},
  ): NatsSubscriptionLike {
    this.#assertOpen();

    const subscription = this.broker.subscribe(subject, options);
    this.#subscriptions.push(subscription);

    return subscription;
  }

  jetstream(): NatsJetStreamLike {
    const stream = this.broker.jetstream(() => !this.#closed);

    return {
      publish: async (subject, data, options) => {
        this.#assertOpen();

        return await stream.publish(subject, data, options);
      },
      subscribe: async (subject, options) => {
        this.#assertOpen();
        this.#consumers.add(`${options.stream}/${options.durable}`);

        return await stream.subscribe(subject, options);
      },
    };
  }

  async jetstreamManager(): Promise<NatsJetStreamManagerLike> {
    this.#assertOpen();

    return await this.broker.jetstreamManager();
  }

  async drain(): Promise<void> {
    this.#closed = true;

    for (const subscription of this.#subscriptions) {
      subscription.unsubscribe();
    }
    this.#subscriptions.length = 0;

    this.broker.releaseInFlight(this.#consumers);
  }

  async closed(): Promise<void> {
    /* соединение закрывается только `drain()` */
  }

  #assertOpen(): void {
    if (this.#closed) {
      throw new NatsDoubleError(
        NATS_CONNECTION_CLOSED,
        'CONNECTION_CLOSED: the connection is drained',
      );
    }
  }
}

/**
 * Коннектор, отдающий двойник, — то, что передаётся в `nats({ connect })`.
 *
 * Один и тот же двойник, отданный двум сборкам, моделирует **кластер**:
 * два процесса на одном брокере. Именно так проверяются queue-группы и
 * split-развёртывание.
 *
 * @param broker - Двойник; не задан — заводится собственный
 */
export const natsDouble =
  (broker: NatsDouble = new NatsDouble()) =>
  async (): Promise<NatsLike> =>
    broker.connection();
