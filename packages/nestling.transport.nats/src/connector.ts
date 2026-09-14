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
 *
 * Перечень и клиент сходятся в `adapt`: она собирает `NatsLike` полем за
 * полем, поэтому разошедшуюся сигнатуру показывает тайпчек, а не прогон
 * против брокера.
 */

import type * as natsClient from 'nats';

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

  /**
   * Брокер снял повтор окном дедупликации потока.
   *
   * Без этого признака дубль не отличить от первой публикации: `seq` у
   * него называет запись, которая уже лежит в потоке.
   */
  readonly duplicate: boolean;
}

/**
 * Сообщение потока: доставка плюс подтверждения обработки.
 *
 * Ответа вызывающему здесь нет — у сообщения потока нет и адреса ответа:
 * `respond` принадлежит core-доставке, и глагол, которого транспорт на
 * этом пути не зовёт, в перечень не входит.
 */
export interface NatsJsMsgLike {
  readonly subject: string;
  readonly data: Uint8Array;
  readonly headers?: NatsHeadersLike;

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

  /**
   * Окно дедупликации в наносекундах.
   *
   * Имя поля и единица взяты у API брокера — как у соседних
   * `durable_name` и `max_deliver`. Коннектор перечисляет поля брокера
   * его же словами: переименование спрятало бы то, что подстановщик
   * своего клиента обязан узнать.
   *
   * Поле не задано — поток берёт умолчание сервера.
   */
  duplicate_window?: number;
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
 * То, что адаптеру нужно от модуля клиента помимо соединения.
 *
 * `headers` — конструктор набора заголовков: у соединения такого метода
 * нет. `AckPolicy` — перечисление политик подтверждения: за границу оно не
 * выходит, там политика названа строкой.
 */
type NatsClientStatics = Pick<typeof natsClient, 'AckPolicy' | 'headers'>;

/** Сообщение потока: подтверждения плюс номер попытки из `info` */
const adaptJsMsg = (msg: natsClient.JsMsg): NatsJsMsgLike => ({
  subject: msg.subject,
  data: msg.data,
  headers: msg.headers,
  redeliveryCount: msg.info.redeliveryCount,
  ack: () => msg.ack(),
  nak: () => msg.nak(),
  term: () => msg.term(),
});

/** Поток сообщений потребителя — тем же генератором, но уже границей */
async function* adaptJsMsgs(
  source: AsyncIterable<natsClient.JsMsg>,
): AsyncGenerator<NatsJsMsgLike> {
  for await (const msg of source) {
    yield adaptJsMsg(msg);
  }
}

/**
 * Собирает `NatsLike` из соединения клиента.
 *
 * Каждое поле присваивается явно — в этом весь смысл: расхождение в любой
 * сигнатуре становится ошибкой тайпчека, а не отказом в проде.
 *
 * @param connection - Открытое соединение клиента
 * @param client - Конструктор заголовков и перечисление политик
 */
function adapt(
  connection: natsClient.NatsConnection,
  { AckPolicy, headers }: NatsClientStatics,
): NatsLike {
  /**
   * Переливает заголовки границы в набор клиента.
   *
   * Внутрь граница пропускает набор клиента как есть — `MsgHdrs` шире
   * `NatsHeadersLike`. Обратно клиент принимает только свой тип целиком,
   * и перелив стоит дешевле приведения, которого компилятор не проверит:
   * в конверте вызова заголовков единицы.
   */
  const toMsgHdrs = (
    source?: NatsHeadersLike,
  ): natsClient.MsgHdrs | undefined => {
    if (!source) {
      return undefined;
    }

    const target = headers();

    for (const key of source.keys()) {
      target.set(key, source.get(key));
    }

    return target;
  };

  const jetstream = (): NatsJetStreamLike => {
    const js = connection.jetstream();

    return {
      publish: async (subject, data, options) => {
        const hdrs = toMsgHdrs(options?.headers);

        return js.publish(subject, data, {
          ...(hdrs !== undefined && { headers: hdrs }),
          ...(options?.timeout !== undefined && { timeout: options.timeout }),
        });
      },

      /*
       * Адрес здесь не нужен: фильтр по subject'у лежит в определении
       * потребителя, а потребитель уже создан управляющим API. Граница
       * называет адрес, потому что им она пользуется у двойника
       */
      subscribe: async (_subject, { stream, durable }) => {
        const consumer = await js.consumers.get(stream, durable);

        return adaptJsMsgs(await consumer.consume());
      },
    };
  };

  return {
    publish: (subject, data, options) => {
      const hdrs = toMsgHdrs(options?.headers);

      connection.publish(
        subject,
        data,
        hdrs === undefined ? undefined : { headers: hdrs },
      );
    },

    request: (subject, data, { timeout, headers: envelope }) => {
      const hdrs = toMsgHdrs(envelope);

      return connection.request(subject, data, {
        timeout,
        ...(hdrs !== undefined && { headers: hdrs }),
      });
    },

    subscribe: (subject, options) => connection.subscribe(subject, options),

    jetstream,

    jetstreamManager: async () => {
      const jsm = await connection.jetstreamManager();

      return {
        streams: {
          add: async (config) => {
            const { config: created } = await jsm.streams.add(config);

            return created;
          },
          info: (name) => jsm.streams.info(name),
        },
        consumers: {
          add: async (stream, config) => {
            const { config: created } = await jsm.consumers.add(stream, {
              ...config,
              ack_policy: AckPolicy.Explicit,
            });

            // Перечисление клиента за границу не выходит: политика
            // подтверждения там названа строкой, и другой у потребителя
            // транспорта быть не может
            return {
              durable_name: created.durable_name ?? config.durable_name,
              ack_policy: 'explicit',
              ...(created.filter_subject !== undefined && {
                filter_subject: created.filter_subject,
              }),
              max_deliver: created.max_deliver,
            };
          },
        },
      };
    },

    drain: () => connection.drain(),
    closed: () => connection.closed(),
    headers: () => headers(),
  };
}

/**
 * Умолчательный коннектор поверх клиента `nats`.
 *
 * Импорт динамический, потому что пакет обязан оставаться пригодным для
 * тестов на двойнике: сборка, подставившая свой `connect`, клиент брокера
 * не грузит вовсе.
 */
export const defaultConnector: NatsConnector = async ({ servers }) => {
  const { AckPolicy, connect, headers } = await import('nats');

  const connection = await connect({ servers: [...servers] });

  return adapt(connection, { AckPolicy, headers });
};
