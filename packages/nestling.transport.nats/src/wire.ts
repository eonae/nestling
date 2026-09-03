/**
 * Сериализация: кодек тела и конверт в headers.
 *
 * Разделение не декоративное. Тело — payload вызова, и его формат
 * заменяем (`codec` в опциях фабрики). Конверт — эксплуатационный профиль
 * (`timeoutMs`, `idempotencyKey`, провозимый контекст), и он передаётся
 * **headers'ами**: так его видно в `nats sub`, так его не нужно
 * распаковывать, чтобы принять решение о бюджете, и так он не смешивается
 * с данными операции.
 *
 * Ограничение JSON-кодека называется прямо: он строже, чем
 * `structuredClone`, который в режиме `always-remote` ведёт себя так же,
 * как сериализация по сети (`Date` превращается в строку, `Map`, `Set` и
 * `undefined` теряются). Молчаливой потери при этом не бывает: вход
 * валидируется схемой операции **на приёме**, поэтому поле, сжавшееся до
 * строки, даёт отказ валидации с именем поля.
 */

import type { NatsHeadersLike } from './connector.js';

import type { SuccessStatus } from '@nestling/operations';
import { categoryOf, InternalError, isCategory } from '@nestling/operations';
import type { ErrorDetails, ResponseContext } from '@nestling/pipeline';

/** Кодек тела сообщения: заменяем опцией фабрики */
export interface NatsCodec {
  encode(value: unknown): Uint8Array;
  decode(data: Uint8Array): unknown;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Умолчательный кодек: дебажимость сообщения дороже нескольких процентов */
export const jsonCodec: NatsCodec = {
  encode: (value) => encoder.encode(JSON.stringify(value ?? null)),
  decode: (data) => {
    const text = decoder.decode(data);

    return text.length === 0 ? undefined : JSON.parse(text);
  },
};

/** Заголовок остатка бюджета — относительного, а не момента */
export const TIMEOUT_HEADER = 'Nl-Timeout-Ms';

/** Заголовок ключа идемпотентности команды */
export const IDEMPOTENCY_HEADER = 'Nl-Idempotency-Key';

/** Заголовок адреса — только для диагностики в `nats sub` */
export const SUBJECT_HEADER = 'Nl-Subject';

/**
 * Заголовок провозимого контекста: **один** на всё, значение — JSON-объект.
 *
 * Не `Nl-Ctx-<ключ>` по заголовку на переменную, как предполагал дизайн:
 * клиент брокера канонизирует имена заголовков по правилам MIME
 * (`Nl-Ctx-tenantId` → `Nl-Ctx-Tenantid`), поэтому ключ переменной в имени
 * заголовка не переживает канонизацию, а ключ ambient-переменной обязан
 * прийти буквально — он же имя поля накопленного `input`. Значение
 * заголовка канонизации не подвергается, поэтому ключи живут в нём.
 */
export const CONTEXT_HEADER = 'Nl-Ctx';

/**
 * Ответ req-reply в теле сообщения.
 *
 * Успех несёт свой статус (`created` и подобные не восстановить иначе),
 * отказ — только тело с `code`: категория восстанавливается из кода на
 * стороне вызывающего. Заголовки `Ok` едут заголовками сообщения, а не
 * телом.
 */
export interface WireReply {
  readonly isSuccess: boolean;
  readonly status?: SuccessStatus;
  readonly value: unknown;
}

/** Кладёт контекст ответа в тело ответного сообщения */
export function encodeReply(response: ResponseContext): WireReply {
  return response.isSuccess
    ? { isSuccess: true, status: response.status, value: response.value }
    : { isSuccess: false, value: response.value };
}

/**
 * Восстанавливает контекст ответа из тела ответного сообщения.
 *
 * Тело без признака ответа (сообщение от чужого отвечающего) читается как
 * необработанная ошибка: множество ответов шины закрыто, и новых форм
 * транспорт не вводит.
 */
export function decodeReply(data: unknown): ResponseContext {
  const reply = (typeof data === 'object' && data !== null ? data : {}) as {
    isSuccess?: unknown;
    status?: unknown;
    value?: unknown;
  };

  if (reply.isSuccess === true) {
    return {
      isSuccess: true,
      status:
        typeof reply.status === 'string'
          ? (reply.status as SuccessStatus)
          : 'ok',
      value: reply.value,
    };
  }

  const value = (
    typeof reply.value === 'object' && reply.value !== null ? reply.value : {}
  ) as Partial<ErrorDetails>;
  const code = typeof value.code === 'string' ? value.code : InternalError.code;
  const category = categoryOf(code);

  return {
    isSuccess: false,
    status: isCategory(category) ? category : InternalError.category,
    value: {
      ...value,
      error: typeof value.error === 'string' ? value.error : 'Error',
      code,
    },
  };
}

/** Конверт вызова — то же, что несут опции глаголов `IMessageBus` */
export interface WireEnvelope {
  readonly timeoutMs?: number;
  readonly idempotencyKey?: string;
  readonly context?: Record<string, unknown>;
}

/**
 * Кладёт конверт в заголовки.
 *
 * Провозимый контекст кодируется JSON'ом целиком в один заголовок: имена
 * заголовков канонизируются брокером, а ключи ambient-переменных обязаны
 * прийти буквально (см. {@link CONTEXT_HEADER}).
 *
 * @param headers - Пустой набор заголовков от клиента брокера
 * @param subject - Адрес, попадающий в диагностический заголовок
 * @param envelope - Конверт вызова
 */
export function encodeEnvelope(
  headers: NatsHeadersLike,
  subject: string,
  envelope: WireEnvelope,
): NatsHeadersLike {
  headers.set(SUBJECT_HEADER, subject);

  if (envelope.timeoutMs !== undefined) {
    headers.set(TIMEOUT_HEADER, String(Math.trunc(envelope.timeoutMs)));
  }

  if (envelope.idempotencyKey !== undefined) {
    headers.set(IDEMPOTENCY_HEADER, envelope.idempotencyKey);
  }

  if (envelope.context !== undefined) {
    headers.set(CONTEXT_HEADER, JSON.stringify(envelope.context));
  }

  return headers;
}

/**
 * Читает конверт из заголовков доставленного сообщения.
 *
 * Заголовков нет — конверта нет: сообщение, пришедшее не от вызывателя
 * (например, из `nats pub` руками), обслуживается как вызов без профиля.
 * Нечитаемое значение провозимой переменной **отбрасывается**, а не валит
 * доставку: провоз пересекает границу доверия, и один кривой заголовок не
 * повод потерять сообщение.
 */
export function decodeEnvelope(headers?: NatsHeadersLike): WireEnvelope {
  if (!headers) {
    return {};
  }

  const envelope: {
    timeoutMs?: number;
    idempotencyKey?: string;
    context?: Record<string, unknown>;
  } = {};

  if (headers.has(TIMEOUT_HEADER)) {
    const timeoutMs = Number(headers.get(TIMEOUT_HEADER));

    if (Number.isFinite(timeoutMs)) {
      envelope.timeoutMs = timeoutMs;
    }
  }

  if (headers.has(IDEMPOTENCY_HEADER)) {
    envelope.idempotencyKey = headers.get(IDEMPOTENCY_HEADER);
  }

  if (headers.has(CONTEXT_HEADER)) {
    try {
      const parsed: unknown = JSON.parse(headers.get(CONTEXT_HEADER));

      if (typeof parsed === 'object' && parsed !== null) {
        envelope.context = parsed as Record<string, unknown>;
      }
    } catch {
      /* нечитаемый контекст просто отбрасывается: терять сообщение незачем */
    }
  }

  return envelope;
}
