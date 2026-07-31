/* eslint-disable unicorn/throw-new-error --
 * `UnknownError(...)` и `ValidationFailed(...)` — вызываемые **определения**
 * `defineFail`, а не классы ошибок: `new` тут менял бы смысл записи, а имя
 * лишь выглядит классовым. */
/**
 * Вызыватели: local- и remote-клиент плюс общий нормализатор ответа.
 *
 * Клиент — константа, выбранная на сборке; на вызове никакого поиска
 * реализации, выбора транспорта или чтения конфигурации не происходит.
 * Тип call-site у обоих клиентов идентичен — в этом весь смысл порта.
 */

import type { AnyContract } from './contract.js';
import type { CommandMeta, Emitter, Port, PortMeta } from './families.js';
import type { CallBudget } from './profile.js';
import {
  isExhausted,
  profileAttributes,
  remainingMs,
  startBudget,
} from './profile.js';
import { failureResponse } from './response.js';
import type { PortRuntime } from './runtime.js';
import { BUS_TRANSPORT_NAME } from './transport.js';
import { WireCopyError } from './wire.js';

import type { Schema } from '@common/misc';
import { SchemaValidationError } from '@common/misc';
import type {
  AnyFail,
  AnyFailDefinition,
  AnyInput,
  EndpointMeta,
  ExtendableContext,
  Fail,
  Raw,
  ResponseContext,
} from '@nestling/pipeline';
import {
  DeadlineExceeded,
  describeForm,
  makeEmptyContext,
  Ok,
  parsePayload,
  UnknownError,
  ValidationFailed,
} from '@nestling/pipeline';

/** Маркер отмены: вызов не ждёт обработчика, проигнорировавшего сигнал */
const ABORTED = Symbol('nestling:port-aborted');

/** Профиль, доезжающий до обработчика транспортными атрибутами */
interface CallProfile {
  readonly deadline?: Date;
  readonly idempotencyKey?: string;
}

/** Что известно вызывателю о своём контракте и биндинге */
export interface InvokerContext {
  /** Контракт: схемы, вид и объявленные отказы */
  readonly contract: AnyContract;

  /** Держатель исполнителей, наполняемый на WIRE */
  readonly runtime: PortRuntime;

  /**
   * Паттерны co-located реализаций: один у `request`/`command`, ноль и
   * более у `event`.
   */
  readonly patterns: readonly string[];
}

/**
 * Схема-лист value-формы или `undefined`, если валидировать нечем.
 *
 * Примитивные листы (`'binary'`/`'text'`) и не-value формы шине недоступны:
 * их отвергает проверка форм против её способностей.
 */
function leafSchemaOf(io: unknown): Schema | undefined {
  const form = describeForm(io);

  if (form.kind !== 'value' || !form.leaf) {
    return undefined;
  }

  return form.leaf === 'binary' || form.leaf === 'text'
    ? undefined
    : (form.leaf as Schema);
}

/** Отказ валидации с читаемыми деталями */
function validationFail(
  message: string,
  issues?: readonly { message: string }[],
): AnyFail {
  return ValidationFailed(issues ?? [{ message }]);
}

/**
 * Валидирует payload по `input`-схеме контракта.
 *
 * Выполняется на **обоих** путях биндинга: по проводу вход проверялся бы
 * границей, и co-located вызов обязан вести себя так же — иначе разъезд
 * фич по процессам менял бы поведение.
 */
function validateInput(
  contract: AnyContract,
  payload: unknown,
): { ok: true; value: unknown } | { ok: false; fail: AnyFail } {
  const schema = leafSchemaOf(contract.input);

  if (!schema) {
    return { ok: true, value: payload };
  }

  try {
    return {
      ok: true,
      value: parsePayload(schema, {
        payload: payload as Record<string, unknown>,
        metadata: {},
      }),
    };
  } catch (error) {
    if (error instanceof SchemaValidationError) {
      return { ok: false, fail: ValidationFailed(error.issues) };
    }

    return {
      ok: false,
      fail: validationFail(
        `Contract '${contract.name}': input does not match its schema`,
      ),
    };
  }
}

/**
 * Общий нормализатор «ответ границы → `Ok | Fail`».
 *
 * Один и тот же для co-located и remote путей: код отказа сопоставляется с
 * определениями `errors:` контракта, и при совпадении создаётся
 * **настоящий** `Fail` этого определения (со `status`, `code` и валидными
 * `details`); незадекларированный или отсутствующий код даёт
 * `UnknownError`, а оригинал уходит в диагностический хук.
 *
 * Kernel-коды ре-гидрируются наравне с объявленными: страж границы считает
 * их контрактными для любой ручки, значит и множество ответов порта
 * закрыто ими же.
 */
export function normalizePortResponse(
  contract: AnyContract,
  response: ResponseContext,
  runtime: PortRuntime,
  original?: unknown,
): Ok<unknown> | AnyFail {
  if (response.isSuccess) {
    return new Ok(response.status, response.value as never);
  }

  const code = response.value?.code;
  const definitions: readonly AnyFailDefinition[] = [
    ...(contract.errors ?? []),
    ValidationFailed,
    DeadlineExceeded,
  ];
  const definition =
    code === undefined
      ? undefined
      : definitions.find((candidate) => candidate.code === code);

  if (!definition) {
    runtime.report({ contract: contract.name, error: original ?? response });

    return UnknownError();
  }

  try {
    const construct = definition as unknown as (
      details?: unknown,
    ) => Fail<string, unknown>;

    return definition.schema ? construct(response.value.details) : construct();
  } catch (error) {
    // Детали не прошли схему определения: контракт разъехался с
    // реализацией — потребителю это `UnknownError`, диагностика хуку
    runtime.report({ contract: contract.name, error });

    return UnknownError();
  }
}

/**
 * Валидирует успешный ответ по `output`-схеме контракта.
 *
 * Только remote-путь: local-ответ уже прошёл pipeline реализации, и
 * повторная валидация была бы ценой без выгоды.
 */
function validateOutput(
  contract: AnyContract,
  result: Ok<unknown> | AnyFail,
): Ok<unknown> | AnyFail {
  if (!(result instanceof Ok)) {
    return result;
  }

  const schema = leafSchemaOf(contract.output);
  if (!schema) {
    return result;
  }

  try {
    return new Ok(
      result.status,
      parsePayload(schema, {
        payload: result.value as Record<string, unknown>,
        metadata: {},
      }) as never,
    );
  } catch (error) {
    return error instanceof SchemaValidationError
      ? ValidationFailed(error.issues)
      : validationFail(
          `Contract '${contract.name}': reply does not match its output schema`,
        );
  }
}

/** Гонка вызова с отменой: вызов завершается отказом, а не зависает */
async function raceAbort<T>(
  work: Promise<T>,
  signal: AbortSignal,
): Promise<T | typeof ABORTED> {
  if (signal.aborted) {
    return ABORTED;
  }

  return await new Promise<T | typeof ABORTED>((resolve, reject) => {
    const onAbort = (): void => resolve(ABORTED);
    signal.addEventListener('abort', onAbort, { once: true });

    work.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error as Error);
      },
    );
  });
}

/**
 * Отказ отменённого вызова.
 *
 * Различение по владению таймером, а не по `signal.reason`: `reason`
 * приходит из кода вызывающего и доверенным источником не является. Отмена
 * вызывающим остаётся `UnknownError`, какой была до появления бюджета.
 */
function abortedFail(budget: CallBudget): AnyFail {
  return budget.expired ? DeadlineExceeded() : UnknownError();
}

/** Кадр запроса порта: тот же контекст, что построил бы транспорт */
function makeCallContext(
  contract: AnyContract,
  pattern: string,
  payload: unknown,
  signal: AbortSignal,
  profile: CallProfile,
): ExtendableContext<AnyInput> {
  const raw: Raw = {
    transport: BUS_TRANSPORT_NAME,
    pattern,
    payload,
    // Тот же безусловный канал, что у шины: local- и remote-путь кладут
    // профиль одной процедурой, поэтому юнит видит одно и то же
    attributes: profileAttributes({ subject: contract.name, ...profile }),
  };

  const endpoint: EndpointMeta = {
    transport: BUS_TRANSPORT_NAME,
    pattern,
    input: contract.input,
    output: contract.output,
    errors: contract.errors,
  };

  return makeEmptyContext(raw, endpoint, signal);
}

/**
 * Local-клиент: вызов через `dispatch` шины.
 *
 * Полный pipeline реализации, валидация входа и страж границы; payload не
 * копируется и дополнительного async-барьера не вводится. Вызов открывает
 * **собственный** request-scope (`dispatch.call` → `runInRequestScope`),
 * поэтому ambient-контекст вызывающего внутрь реализации не протекает и
 * общей транзакции между ними не существует.
 */
export function makeLocalPort(context: InvokerContext): Port<any> {
  const { contract, runtime, patterns } = context;

  return {
    async call(payload?: unknown, meta?: PortMeta) {
      const input = validateInput(contract, payload);
      if (!input.ok) {
        return input.fail as never;
      }

      // Fail-fast до вызова: бюджет, исчерпанный к этому моменту, означает,
      // что `dispatch` трогать незачем — обработчик не исполняется вовсе
      if (isExhausted(meta?.deadline)) {
        return DeadlineExceeded() as never;
      }

      const dispatch = runtime.requireDispatch(contract.name);
      const budget = startBudget(meta?.deadline, meta?.signal);
      const [pattern] = patterns;

      const ctx = makeCallContext(
        contract,
        pattern,
        input.value,
        budget.signal,
        {
          deadline: meta?.deadline,
        },
      );

      let response: ResponseContext | typeof ABORTED;
      try {
        response = await raceAbort(
          dispatch.call(pattern, ctx, {
            // Stack внутрь чужой фичи не уезжает — ровно как по проводу
            exposeErrorDetails: false,
            onUnknownFail: (info) =>
              runtime.report({ contract: contract.name, error: info.error }),
          }),
          budget.signal,
        );
      } catch (error) {
        // Реализация без pipeline отказ бросает: собираем ответ границы той
        // же процедурой, что транспорт, и нормализуем его как любой другой
        return normalizePortResponse(
          contract,
          failureResponse(error),
          runtime,
          error,
        ) as never;
      } finally {
        budget.release();
      }

      if (response === ABORTED) {
        runtime.report({
          contract: contract.name,
          error: new Error(`Port '${contract.name}' call was aborted`),
        });

        return abortedFail(budget) as never;
      }

      return normalizePortResponse(contract, response, runtime) as never;
    },
  };
}

/**
 * Remote-клиент: вызов через шину.
 *
 * Путь включает async-барьер, структурную копию payload и ответа
 * (обеспечивает шина) и валидацию ответа по `output`-схеме контракта — то
 * есть честную репетицию провода.
 */
export function makeRemotePort(context: InvokerContext): Port<any> {
  const { contract, runtime } = context;

  return {
    async call(payload?: unknown, meta?: PortMeta) {
      const input = validateInput(contract, payload);
      if (!input.ok) {
        return input.fail as never;
      }

      // Fail-fast до вызова: шина не трогается, сообщение не отправляется
      if (isExhausted(meta?.deadline)) {
        return DeadlineExceeded() as never;
      }

      const bus = runtime.optionalBus(contract.name);

      if (!bus) {
        runtime.report({
          contract: contract.name,
          error: new Error(
            `Port '${contract.name}': no message bus in the assembled ` +
              `application`,
          ),
        });

        return UnknownError() as never;
      }

      const budget = startBudget(meta?.deadline, meta?.signal);
      const timeoutMs = remainingMs(meta?.deadline);

      let response: ResponseContext | typeof ABORTED;
      try {
        response = await raceAbort(
          // По проводу едет **остаток**, а не момент: получатель превратит
          // его обратно в момент по своим часам, и рассинхрон часов между
          // процессами семантику бюджета не изменит
          bus.request(contract.name, input.value, {
            signal: budget.signal,
            timeoutMs,
          }),
          budget.signal,
        );
      } catch (error) {
        // Единственная ошибка этого пути, за которую отвечает вызывающий, —
        // payload, не переживающий провод: она возвращается отказом
        // валидации с текстом, называющим контракт и поле
        if (error instanceof WireCopyError) {
          return validationFail(
            `Contract '${contract.name}': ${error.message}`,
          ) as never;
        }

        return normalizePortResponse(
          contract,
          failureResponse(error),
          runtime,
          error,
        ) as never;
      } finally {
        budget.release();
      }

      if (response === ABORTED) {
        runtime.report({
          contract: contract.name,
          error: new Error(`Port '${contract.name}' call was aborted`),
        });

        return abortedFail(budget) as never;
      }

      return validateOutput(
        contract,
        normalizePortResponse(contract, response, runtime),
      ) as never;
    },
  };
}

/**
 * Local-эмиттер: доставка через `dispatch` каждому co-located подписчику.
 *
 * `Promise<void>` резолвится по факту **доставки** (постановки вызовов), не
 * обработки; отказ подписчика не всплывает вызывающему и не влияет на
 * доставку остальным.
 */
export function makeLocalEmitter(context: InvokerContext): Emitter<any> {
  const { contract, runtime, patterns } = context;

  return {
    async emit(payload?: unknown, meta?: CommandMeta) {
      const input = requireValidPayload(contract, payload);
      requireLiveBudget(meta);

      if (patterns.length === 0) {
        // Broadcast с нулём подписчиков — легальное состояние
        return;
      }

      const dispatch = runtime.requireDispatch(contract.name);
      const profile: CallProfile = {
        deadline: meta?.deadline,
        idempotencyKey: idempotencyKeyOf(contract, meta),
      };

      for (const pattern of patterns) {
        // Бюджет ограничивает **обработчика**, а не ожидание вызывающего:
        // ждать здесь нечего, `emit` резолвится по факту доставки
        const budget = startBudget(meta?.deadline, meta?.signal);
        const ctx = makeCallContext(
          contract,
          pattern,
          input,
          budget.signal,
          profile,
        );

        void dispatch
          .call(pattern, ctx, {
            exposeErrorDetails: false,
            onUnknownFail: (info) =>
              runtime.report({ contract: contract.name, error: info.error }),
          })
          .then((response) => {
            if (!response.isSuccess) {
              runtime.report({ contract: contract.name, error: response });
            }
          })
          .catch((error: unknown) => {
            runtime.report({ contract: contract.name, error });
          })
          .finally(() => budget.release());
      }
    },
  };
}

/** Remote-эмиттер: публикация в шину */
export function makeRemoteEmitter(context: InvokerContext): Emitter<any> {
  const { contract, runtime } = context;

  return {
    async emit(payload?: unknown, meta?: CommandMeta) {
      const input = requireValidPayload(contract, payload);
      requireLiveBudget(meta);

      const bus = runtime.optionalBus(contract.name);

      if (!bus) {
        // Ни одной реализации в приложении: публиковать некуда, и это
        // легально ровно для broadcast'а
        return;
      }

      await bus.publish(contract.name, input, {
        timeoutMs: remainingMs(meta?.deadline),
        idempotencyKey: idempotencyKeyOf(contract, meta),
      });
    },
  };
}

/**
 * Ключ идемпотентности отправляемой команды.
 *
 * `emit` команды **всегда** едет с ключом: переданным вызывающим либо
 * сгенерированным здесь. Ключ рождается в вызывателе, а не в транспорте,
 * потому что стабилен он должен быть относительно **ретраев доставки**:
 * ретрай одного и того же `emit` обязан нести тот же ключ, два разных
 * `emit` — разные. Транспорт не знает, где кончается один `emit`, и такой
 * гарантии дать не может.
 *
 * У `event` ключа нет: у факта, доставляемого 0..N подписчикам, нет
 * идентичности намерения, которую можно было бы дедуплицировать.
 */
function idempotencyKeyOf(
  contract: AnyContract,
  meta: CommandMeta | undefined,
): string | undefined {
  if (contract.kind !== 'command') {
    return undefined;
  }

  return meta?.idempotencyKey ?? crypto.randomUUID();
}

/**
 * Fail-fast бюджета у `emit`.
 *
 * Отказ **бросается**: канала результата у `emit` нет, и это тот же приём,
 * которым сигнализируется невалидный payload.
 */
function requireLiveBudget(meta: PortMeta | undefined): void {
  if (isExhausted(meta?.deadline)) {
    throw DeadlineExceeded();
  }
}

/**
 * Валидирует payload эмиттера, бросая отказ.
 *
 * У `emit` нет канала результата, поэтому невалидный вход — исключение, а
 * не тихая недоставка: это дефект вызывающего кода, и молчать о нём
 * нельзя.
 */
function requireValidPayload(contract: AnyContract, payload: unknown): unknown {
  const input = validateInput(contract, payload);

  if (!input.ok) {
    throw input.fail;
  }

  return input.value;
}
