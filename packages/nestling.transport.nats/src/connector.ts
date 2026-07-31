/**
 * Коннектор — единственное место пакета, знающее про клиент брокера.
 *
 * Отсюда три следствия, ради которых он и заведён: тесты гоняют полную
 * логику транспорта против in-memory двойника без сети; переход на
 * v3-линию клиента (`@nats-io/*`) правит **один** файл; пользователь
 * подставляет свой транспорт в тестах приложения опцией фабрики.
 *
 * `NatsLike` — явный перечень глаголов, на которые опирается транспорт, а
 * не структурный слепок клиента: что именно от брокера нужно, должно
 * читаться списком, а не выясняться грепом.
 */

/** Заголовки сообщения: конверт глаголов шины едет здесь */
export interface NatsHeadersLike {
  get(key: string): string;
  set(key: string, value: string): void;
  has(key: string): boolean;
  keys(): Iterable<string>;
}

/** Доставленное сообщение — то, что видит подписчик */
export interface NatsMsgLike {
  readonly subject: string;
  readonly data: Uint8Array;
  readonly headers?: NatsHeadersLike;

  /** Ответ req-reply; у fire-and-forget адреса ответа нет */
  respond(data?: Uint8Array, options?: { headers?: NatsHeadersLike }): boolean;
}

/** Опции подписки: очередь — это queue-group */
export interface NatsSubscriptionOptions {
  queue?: string;
  callback?: (error: Error | null, msg: NatsMsgLike) => void;
}

/** Хэндл подписки: асинхронный итератор сообщений плюс отписка */
export interface NatsSubscriptionLike extends AsyncIterable<NatsMsgLike> {
  unsubscribe(): void;
  drain(): Promise<void>;
}

/** Подтверждение записи в поток */
export interface NatsPubAckLike {
  readonly stream: string;
  readonly seq: number;
}

/** Сообщение потока: то же плюс подтверждения обработки */
export interface NatsJsMsgLike extends NatsMsgLike {
  /** Номер попытки доставки, начиная с 1 */
  readonly redeliveryCount: number;

  /** Обработано: повторять незачем */
  ack(): void;

  /** Решения не получилось: вернуть в поток */
  nak(): void;

  /** Прекратить доставку: попытки исчерпаны */
  term(): void;
}

/** Определение потока — ровно то, чем транспорт пользуется */
export interface NatsStreamConfigLike {
  name: string;
  subjects: string[];
}

/** Определение durable-потребителя */
export interface NatsConsumerConfigLike {
  durable_name: string;
  ack_policy: 'explicit';
  filter_subject?: string;
  max_deliver?: number;
}

/** Управление JetStream: только то, что нужно долговечной доставке */
export interface NatsJetStreamManagerLike {
  streams: {
    add(config: NatsStreamConfigLike): Promise<NatsStreamConfigLike>;
    info(name: string): Promise<{ config: NatsStreamConfigLike }>;
  };
  consumers: {
    add(
      stream: string,
      config: NatsConsumerConfigLike,
    ): Promise<NatsConsumerConfigLike>;
  };
}

/** Клиент JetStream: публикация с подтверждением и подписка потребителем */
export interface NatsJetStreamLike {
  publish(
    subject: string,
    data: Uint8Array,
    options?: { headers?: NatsHeadersLike; timeout?: number },
  ): Promise<NatsPubAckLike>;

  /**
   * Подписка durable-потребителем.
   *
   * Сознательно узкая: `pull`-семантика, ordered consumers и прочая
   * вендорская специфика за эту границу не выходит.
   */
  subscribe(
    subject: string,
    options: { stream: string; durable: string },
  ): Promise<AsyncIterable<NatsJsMsgLike>>;
}

/**
 * Клиент брокера глазами транспорта.
 *
 * Список закрыт: всё, что транспорт умеет попросить у брокера, — здесь.
 */
export interface NatsLike {
  publish(
    subject: string,
    data: Uint8Array,
    options?: { headers?: NatsHeadersLike },
  ): void;

  request(
    subject: string,
    data: Uint8Array,
    options: { timeout: number; headers?: NatsHeadersLike },
  ): Promise<NatsMsgLike>;

  subscribe(
    subject: string,
    options?: NatsSubscriptionOptions,
  ): NatsSubscriptionLike;

  jetstream(): NatsJetStreamLike;
  jetstreamManager(): Promise<NatsJetStreamManagerLike>;

  /** Дренаж: подписки снимаются, in-flight дорабатывается */
  drain(): Promise<void>;

  /**
   * Резолвится, когда соединение закрылось.
   *
   * Значение — причина закрытия, если она была; штатное закрытие
   * резолвится без неё. Форма клиента, а не наша: транспорт лишь читает.
   */
  /* eslint-disable-next-line @typescript-eslint/no-invalid-void-type --
   * `void` в union'е — форма настоящего клиента `nats`, и сузить её здесь
   * значило бы соврать про то, что коннектор оборачивает */
  closed(): Promise<void | Error>;

  /** Пустой набор заголовков — их конструктор принадлежит клиенту */
  headers(): NatsHeadersLike;
}

/** Опции соединения — тот же минимум */
export interface NatsConnectOptions {
  servers: readonly string[];
}

/**
 * Шов тестируемости: как получить клиента.
 *
 * Подменяется опцией фабрики `nats({ connect })`; умолчание — настоящий
 * клиент, и это **единственный** его импорт во всём пакете.
 */
export type NatsConnector = (options: NatsConnectOptions) => Promise<NatsLike>;

/**
 * Умолчательный коннектор поверх клиента `nats`.
 *
 * Импорт динамический, потому что пакет обязан оставаться пригодным для
 * тестов на двойнике: сборка, подставившая свой `connect`, клиент брокера
 * не грузит вовсе.
 */
export const defaultConnector: NatsConnector = async ({ servers }) => {
  const { connect } = await import('nats');

  return (await connect({
    servers: [...servers],
  })) as unknown as NatsLike;
};
