/**
 * `stub(Operation, impl)` — фейк-вызыватель как значение.
 *
 * Шов «меж-фичевые вызовы»: фича-потребитель тестируется без соседей.
 * Механизм держится на уже существующем свойстве контейнера — явный
 * провайдер члена семейства **опережает** рецепт, поэтому боевой
 * `buildPort`/`buildEmitter` для застабанного операции не вызывается ни
 * разу, а вместе с ним не выполняется и проверка достижимости.
 *
 * Причина существовать у стаба одна: он **валидируется схемами своего
 * операции** на каждом вызове. Мок, разошедшийся с реальностью, падает в
 * тесте, а не в проде.
 */

import type { InjectionToken } from '@nestling/container';
import { asFamilyMember } from '@nestling/container';
import type {
  AnyOperation,
  CommandMeta,
  Emitter,
  EmitterToken,
  EmittingOperation,
  InputOf,
  MetaOf,
  OperationFailsOf,
  OutputOf,
  Port,
  PortMeta,
  PortToken,
  RequestOperation,
  Schema,
} from '@nestling/contracts';
import { EmitterFamily, PortFamily } from '@nestling/contracts';
import type { AnyFail, AnyFailDefinition } from '@nestling/pipeline';
import {
  DeadlineExceeded,
  describeForm,
  isFail,
  Ok,
  parsePayload,
  SchemaValidationError,
  UnknownError,
  ValidationFailed,
} from '@nestling/pipeline';
import { isExhausted } from '@nestling/ports';

/**
 * Стаб операции: пара `токен вызывателя → фейк`.
 *
 * Форма выбрана не ради краткости: `stubs:` уже раскладывает пары в
 * `valueProvider`, а `overrides:` принимает `TokenOverride` той же формы, —
 * значит стаб операции понимается всеми тремя местами без единой строки
 * разбора.
 */
export type OperationStub = readonly [
  token: InjectionToken<any>,
  invoker: Port<any> | Emitter<any>,
];

/**
 * Результат `impl` у стаба `request`-операции.
 *
 * Записан развёрткой `Output<…>`, а не самим `Output<…>`: у того параметр
 * отказов ограничен `AnyFail`, а `OperationFailsOf<C>` при неразрешённом `C`
 * остаётся отложенным условным типом и ограничение не удовлетворяет.
 */
export type StubOutput<C extends RequestOperation<any, any, any>> = Promise<
  Ok<OutputOf<C>> | OperationFailsOf<C> | OutputOf<C>
>;

/**
 * Реализация фейка `request`-операции — обычный хендлер по форме.
 *
 * Автор фейка не учит новую форму, поэтому `jest.fn()` в позиции `impl`
 * работает без единой строки поддержки в пакете: собственного spy у стаба
 * нет и не будет.
 */
export type RequestStubImpl<C extends RequestOperation<any, any, any>> = (
  payload: InputOf<C>,
  meta: MetaOf<C>,
) => StubOutput<C>;

/** Реализация фейка `command`/`event`-операции (см. {@link RequestStubImpl}) */
export type EmitStubImpl<C extends EmittingOperation<any, any, any, any>> = (
  payload: InputOf<C>,
  meta: MetaOf<C>,
) => void | Promise<void>;

/**
 * Kernel-коды, контрактные для любого вызова.
 *
 * Ровно то же множество, что закрывает `KernelPortFail`: проверка границы
 * считает эти коды контрактными для кого угодно, поэтому и фейк может
 * отвечать ими без объявления в `errors:`. Ветка `UnknownError` при этом
 * остаётся тестируемой — `UnknownError()` проходит наравне с объявленными.
 */
const KERNEL_CODES: ReadonlySet<string> = new Set([
  UnknownError.code,
  ValidationFailed.code,
  DeadlineExceeded.code,
]);

/** Fail-fast для JS-потребителей: первый аргумент — значение `makeRequest` */
function assertOperation(contract: unknown): asserts contract is AnyOperation {
  const kind = (contract as { kind?: unknown } | undefined)?.kind;
  const name = (contract as { name?: unknown } | undefined)?.name;

  if (typeof name !== 'string' || typeof kind !== 'string') {
    throw new TypeError(
      `stub(contract, impl): the first argument must be an operation ` +
        `created by makeRequest / makeCommand / makeEvent.`,
    );
  }
}

/**
 * Схема-лист value-формы или `undefined`, если валидировать нечем.
 *
 * Примитивные листы (`'binary'`/`'text'`) и не-value формы шине недоступны:
 * их отвергает проверка форм против её способностей ещё на ASSEMBLE.
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

/** Разбор значения листовой схемой формы io */
function parseLeaf(
  io: unknown,
  value: unknown,
  message: string,
): { ok: true; value: unknown } | { ok: false; fail: AnyFail } {
  const schema = leafSchemaOf(io);

  if (!schema) {
    return { ok: true, value };
  }

  try {
    return {
      ok: true,
      value: parsePayload(schema, {
        payload: value as Record<string, unknown>,
        metadata: {},
      }),
    };
  } catch (error) {
    return {
      ok: false,
      fail:
        error instanceof SchemaValidationError
          ? ValidationFailed(error.issues)
          : ValidationFailed([{ message }]),
    };
  }
}

/** Разбор входа: та же процедура для обеих сторон вызывателя */
function parseInput(
  contract: AnyOperation,
  payload: unknown,
): { ok: true; value: unknown } | { ok: false; fail: AnyFail } {
  return parseLeaf(
    contract.input,
    payload,
    `Operation '${contract.name}': input does not match its schema`,
  );
}

/**
 * Разбор успешного результата фейка.
 *
 * Стаб строже боевого co-located порта, и это осознанная асимметрия:
 * боевой ответ уже прошёл pipeline реализации с его валидацией, а у стаба
 * pipeline'а нет вовсе — обёртка и есть единственное место, где та же
 * гарантия выразима.
 */
function parseOutput(
  contract: AnyOperation,
  value: unknown,
): { ok: true; value: unknown } | { ok: false; fail: AnyFail } {
  return parseLeaf(
    contract.output,
    value,
    `stub(${contract.name}, …): the fake answered with a value that does ` +
      `not match the output schema of the contract`,
  );
}

/**
 * Проверяет, что отказ фейка входит в операция.
 *
 * Незадекларированный код — дефект **теста**, поэтому обёртка бросает, а не
 * нормализует его в `UnknownError`, как сделал бы боевой порт: тот защищает
 * потребителя от чужой реализации, которую не контролирует, а автор стаба
 * контролирует обе стороны, и молчаливое превращение только скрыло бы, что
 * фейк вышел за операция.
 */
function requireDeclaredFail(contract: AnyOperation, fail: AnyFail): AnyFail {
  const definitions: readonly AnyFailDefinition[] = contract.errors ?? [];
  const declared = definitions.map((definition) => definition.code);
  const { code } = fail;

  if (
    code !== undefined &&
    (KERNEL_CODES.has(code) || declared.includes(code))
  ) {
    return fail;
  }

  const allowed = [...declared, ...KERNEL_CODES]
    .map((known) => `'${known}'`)
    .join(', ');

  throw new Error(
    `stub(${contract.name}, …): the fake answered with ` +
      `${code === undefined ? 'an anonymous failure (no code)' : `failure code '${code}'`}, ` +
      `which the contract does not declare. Allowed codes: ${allowed}. ` +
      `Either add the failure to 'errors:' of the contract, or fix the fake — ` +
      `an answer outside the contract is a defect of the test, not an answer ` +
      `of the neighbour.`,
  );
}

/**
 * Приводит брошенное фейком к ответу вызывателя.
 *
 * Отказ, брошенный фейком, — тот же ответ, что и возвращённый («возврат
 * `Fail` эквивалентен броску»). А вот **не**-`Fail` пробрасывается как
 * есть: источник такого исключения — код самого теста, и превращать «фейк
 * упал» в «сосед вернул `UNKNOWN`» значит прятать дефект теста от теста.
 */
function failOfThrown(contract: AnyOperation, error: unknown): AnyFail {
  if (isFail(error)) {
    return requireDeclaredFail(contract, error as AnyFail);
  }

  throw error;
}

/** Фейк-порт: валидация входа и выхода, бюджет и множество отказов */
function makePortStub(
  contract: AnyOperation,
  impl: (payload: any, meta: any) => unknown,
): Port<any> {
  return {
    async call(payload?: unknown, meta?: PortMeta) {
      const input = parseInput(contract, payload);
      if (!input.ok) {
        return input.fail as never;
      }

      // Fail-fast до вызова фейка: иначе тест на дедлайны проходил бы со
      // стабом и падал в проде
      if (isExhausted(meta?.deadline)) {
        return DeadlineExceeded() as never;
      }

      let result: unknown;
      try {
        result = await impl(input.value, meta ?? {});
      } catch (error) {
        return failOfThrown(contract, error) as never;
      }

      if (isFail(result)) {
        return requireDeclaredFail(contract, result as AnyFail) as never;
      }

      const returned = result instanceof Ok ? result.value : result;
      const output = parseOutput(contract, returned);

      if (!output.ok) {
        return output.fail as never;
      }

      // Статус берётся из `Ok` фейка, а у голого значения он умолчательный:
      // форма результата та же, что у обычного хендлера
      return new Ok(
        result instanceof Ok ? result.status : 'OK',
        output.value as never,
      ) as never;
    },
  };
}

/**
 * Ключ идемпотентности стаб-эмиттера — по правилам боевого.
 *
 * `emit` команды **всегда** едет с ключом: переданным вызывающим либо
 * отчеканенным здесь. Иначе тест «ключ всегда есть» проходил бы со стабом и
 * расходился с прод-поведением ровно в том месте, ради которого ключ
 * чеканится в вызывателе, а не в транспорте.
 */
function stubMeta(
  contract: AnyOperation,
  meta: CommandMeta | undefined,
): CommandMeta {
  return contract.kind === 'command'
    ? { ...meta, idempotencyKey: meta?.idempotencyKey ?? crypto.randomUUID() }
    : { ...meta };
}

/** Фейк-эмиттер: у `emit` нет канала результата, поэтому отказы бросаются */
function makeEmitterStub(
  contract: AnyOperation,
  impl: (payload: any, meta: any) => unknown,
): Emitter<any> {
  return {
    async emit(payload?: unknown, meta?: CommandMeta) {
      const input = parseInput(contract, payload);
      if (!input.ok) {
        throw input.fail;
      }

      if (isExhausted(meta?.deadline)) {
        throw DeadlineExceeded();
      }

      try {
        await impl(input.value, stubMeta(contract, meta));
      } catch (error) {
        throw failOfThrown(contract, error);
      }
    },
  };
}

/**
 * Строит фейк-вызыватель операции.
 *
 * Сторона вызывателя выбирается **видом операции**, а не вызывающим:
 * `request` даёт пару с `contract.caller`, `command`/`event` — с
 * `contract.emitter`. Пара едет полем `stubs:` (`assembleTest`,
 * `testModule`) и структурно годна для `overrides:`.
 *
 * @param contract - Операция, объявленный `makeRequest`
 * @param impl - Реализация фейка: обычный хендлер по форме
 * @returns Пара `токен вызывателя → фейк` для поля `stubs:`
 * @throws {TypeError} Если первым аргументом передан не операция
 *
 * @example
 * ```typescript
 * await using app = await assembleTest({
 *   features: [OrdersFeature],
 *   select: 'orders',
 *   stubs: [stub(ClaimQuota, async () => ({ granted: 1 }))],
 * });
 * ```
 */
export function stub<C extends RequestOperation<any, any, any>>(
  contract: C,
  impl: RequestStubImpl<C>,
): readonly [token: PortToken<C>, invoker: Port<C>];
export function stub<C extends EmittingOperation<any, any, any, any>>(
  contract: C,
  impl: EmitStubImpl<C>,
): readonly [token: EmitterToken<C>, invoker: Emitter<C>];
export function stub(
  contract: AnyOperation,
  impl: (payload: any, meta: any) => unknown,
): OperationStub {
  assertOperation(contract);

  if (contract.kind === 'request') {
    const request = contract as RequestOperation<any, any, any>;

    return [request.caller, makePortStub(contract, impl)] as const;
  }

  const emitting = contract as EmittingOperation<any, any, any, any>;

  return [emitting.emitter, makeEmitterStub(contract, impl)] as const;
}

/**
 * Имена операций, застабанных списком `stubs:`.
 *
 * Состав читается по **членству токена в семействах вызывателей**, а не по
 * бренду на паре: тест, написавший `[ChargeCard.caller, fake]` руками, тоже
 * подменил операция, и отчёт обязан это показывать. Обычные пары
 * `токен → значение` в состав не входят — это не операции.
 */
export function stubbedContracts(
  stubs: readonly (readonly [InjectionToken<any>, unknown])[] = [],
): readonly string[] {
  const names = new Set<string>();

  for (const [token] of stubs) {
    const member = asFamilyMember(token);

    if (member?.family === PortFamily || member?.family === EmitterFamily) {
      names.add(member.param);
    }
  }

  return [...names].sort();
}
