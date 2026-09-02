/**
 * Разбор ответа: успех, валидация по `output` и восстановление `Fail` из
 * ответа.
 *
 * Множество результата закрыто как `E ∪ UnknownError` — то же, что у порта.
 * Иных кодов клиент не вводит: `default`-ветка, написанная для `.port`,
 * переносится на клиента без правок.
 */

import type {
  AnyFail,
  AnyFailDefinition,
  StandardSchemaV1,
  SuccessStatus,
} from '@nestling/contracts';
import {
  describeForm,
  Fail,
  isPrimitiveLeaf,
  Ok,
  UnknownError,
} from '@nestling/contracts';

/** Тело отказа по сети — то же, что собирает серверная граница */
interface WireFailure {
  error?: unknown;
  code?: unknown;
  details?: unknown;
}

/**
 * HTTP-код успеха обратно в статус.
 *
 * Прочие 2xx схлопываются в `OK`: словарь статусов ядра закрыт, и вводить
 * ради экзотического кода новый элемент значило бы расширять операция
 * ответа по чужому решению.
 */
const SUCCESS_BY_CODE: Readonly<Record<number, SuccessStatus>> = {
  200: 'OK',
  201: 'CREATED',
  202: 'ACCEPTED',
  204: 'NO_CONTENT',
};

/** Отказ «что-то пошло не так, и операция этого не описывает» */
export function unknownFailure(message: string, cause: unknown): AnyFail {
  return new Fail('INTERNAL_ERROR', message, {
    code: UnknownError.code,
    cause,
  });
}

/**
 * Валидирует значение схемой формы `output`.
 *
 * Синхронность обязательна: `Promise` из `~standard.validate` — ошибка
 * конфигурации, ровно как в ядре. Валидация живёт здесь, а не через
 * `validateSync` из `@common/misc`, потому что её отказ обязан стать
 * `Fail`, а не исключением: клиент не бросает на контрактных сбоях.
 */
function validateOutputValue(
  output: unknown,
  value: unknown,
): { ok: true; value: unknown } | { ok: false; issues: unknown } {
  const form = describeForm(output);
  const leaf = form.leaf;

  if (leaf === undefined || isPrimitiveLeaf(leaf)) {
    return { ok: true, value };
  }

  const schema = leaf as StandardSchemaV1;
  const result = schema['~standard'].validate(value);

  if (typeof (result as PromiseLike<unknown>)?.then === 'function') {
    return {
      ok: false,
      issues: new Error(
        'Schema validation must be synchronous, but `~standard.validate` ' +
          'returned a Promise.',
      ),
    };
  }

  const sync = result as StandardSchemaV1.Result<unknown>;

  return sync.issues
    ? { ok: false, issues: sync.issues }
    : { ok: true, value: sync.value };
}

/** Разбирает успешный ответ в `Ok` либо в `UnknownError` */
export function readSuccess(
  status: number,
  body: unknown,
  output: unknown,
  validate: boolean,
  where: string,
): Ok<unknown> | AnyFail {
  if (status === 204) {
    return new Ok('NO_CONTENT', null);
  }

  const okStatus = SUCCESS_BY_CODE[status] ?? 'OK';

  if (!validate) {
    return new Ok(okStatus, body as never);
  }

  const checked = validateOutputValue(output, body);

  return checked.ok
    ? new Ok(okStatus, checked.value as never)
    : unknownFailure(
        `${where}: the response did not match the contract's 'output' schema.`,
        checked.issues,
      );
}

/**
 * Восстанавливает отказ по коду из `errors:` операции.
 *
 * Статус берётся из **определения** (сервер мог ответить любым — операция
 * знает лучше), `message` — из ответа (он про конкретный случай), `details`
 * — тоже из ответа, но проверенные схемой определения. Не сошлись детали —
 * `UnknownError`: отказ с невалидными деталями хуже честного «не знаю».
 */
export function readFailure(
  status: number,
  body: unknown,
  errors: readonly AnyFailDefinition[] | undefined,
  where: string,
): AnyFail {
  const wire = (
    typeof body === 'object' && body !== null ? body : {}
  ) as WireFailure;
  const code = typeof wire.code === 'string' ? wire.code : undefined;
  const definition = code
    ? errors?.find((candidate) => candidate.code === code)
    : undefined;

  if (!definition) {
    return unknownFailure(
      `${where}: the service answered ${status.toString()} with ` +
        `${code === undefined ? 'no error code' : `an undeclared code '${code}'`}.`,
      body,
    );
  }

  let details: unknown;
  if (definition.schema) {
    const result = definition.schema['~standard'].validate(wire.details);

    if (typeof (result as PromiseLike<unknown>)?.then === 'function') {
      return unknownFailure(
        `${where}: the schema of '${definition.code}' is asynchronous.`,
        body,
      );
    }

    const sync = result as StandardSchemaV1.Result<unknown>;
    if (sync.issues) {
      return unknownFailure(
        `${where}: the details of '${definition.code}' did not match the ` +
          `schema declared for it.`,
        body,
      );
    }
    details = sync.value;
  }

  const message =
    typeof wire.error === 'string' && wire.error.length > 0
      ? wire.error
      : definition.code;

  return new Fail(definition.status, message, {
    code: definition.code,
    ...(details === undefined ? {} : { details }),
  });
}
