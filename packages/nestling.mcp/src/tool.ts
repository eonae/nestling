/**
 * `tool(operation, options?)` — объявление инструмента значением.
 *
 * Функция чистая: она читает операцию и словарь и возвращает значение. В
 * приложении оно оказывается только через список `tools:` плагина
 * `mcp(...)`; реестра, который наполнялся бы вызовами `tool(...)` при
 * импорте, у пакета нет.
 *
 * Имя и описание выводятся здесь, а проверяются при сборке: нарушения
 * объявления сообщаются одним списком на фазе ASSEMBLE, а не по одному в
 * точке вызова. Здесь бросаются только ошибки аргумента — чужой вид
 * операции и неизвестное поле словаря.
 */

import type { McpToolAnnotations } from './types.js';

import type { RequestOperation } from '@nestlingjs/operations';

/** Операция вида `request` с любыми схемами и отказами */
export type AnyRequestOperation = RequestOperation<any, any, any>;

/** Имя инструмента, которое принимает протокол */
export const TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

/**
 * Словарь объявления инструмента: то, что нужно агенту и чего нет в
 * декларации операции.
 *
 * Схемы, отказы и адрес берутся с операции, поэтому полей для них здесь
 * нет.
 */
export interface McpToolOptions {
  /**
   * Имя инструмента. Без него имя выводится из имени операции: точки
   * заменяются подчёркиваниями.
   */
  readonly name?: string;

  /**
   * Описание для агента. Без него берётся `doc.description`, затем
   * `doc.summary` операции.
   */
  readonly description?: string;

  /** Подсказки агенту о характере инструмента */
  readonly annotations?: McpToolAnnotations;
}

/** Поля словаря; этот же список печатает текст ошибки */
const OPTION_FIELDS = ['name', 'description', 'annotations'] as const;

/**
 * Объявленный инструмент: операция и то, что к ней добавил автор.
 *
 * Имя уже выведено, описание — тоже. Значение `undefined` в `description`
 * означает, что описания не нашлось ни в словаре, ни в секции `doc`; это
 * нарушение, и оно сообщается при сборке плагина.
 */
export interface DeclaredTool<
  C extends AnyRequestOperation = AnyRequestOperation,
> {
  /** Операция, которую выставляет инструмент */
  readonly operation: C;

  /** Имя инструмента: из словаря либо выведенное из имени операции */
  readonly name: string;

  /** Выведено ли имя подстановкой точек: причина совпадения имён */
  readonly nameDerived: boolean;

  /** Описание для агента; `undefined` — описания не нашлось */
  readonly description?: string;

  /** Подсказки агенту о характере инструмента */
  readonly annotations?: McpToolAnnotations;
}

/** Проверяет, что первым аргументом пришла операция вида `request` */
function assertRequestOperation(
  operation: unknown,
): asserts operation is AnyRequestOperation {
  const kind = (operation as { kind?: unknown } | undefined)?.kind;
  const name = (operation as { name?: unknown } | undefined)?.name;

  if (typeof name !== 'string' || typeof kind !== 'string') {
    throw new TypeError(
      `tool(operation, { … }): the first argument must be an operation ` +
        `value created by makeRequest.`,
    );
  }

  if (kind !== 'request') {
    throw new TypeError(
      `tool(${name}, { … }): the operation is of kind '${kind}', and a tool ` +
        `requires kind 'request'. A command and an event are called through ` +
        `an emitter: 'emit' resolves on delivery and returns no result the ` +
        `agent could read. Declare the operation with makeRequest.`,
    );
  }
}

/** Проверяет состав словаря; неизвестное поле отвергается с перечнем полей */
function assertOptions(name: string, options: McpToolOptions): void {
  if (typeof options !== 'object' || options === null) {
    throw new TypeError(
      `tool(${name}, options): the second argument must be an object with ` +
        `${OPTION_FIELDS.join(', ')}.`,
    );
  }

  for (const field of Object.keys(options)) {
    if (!(OPTION_FIELDS as readonly string[]).includes(field)) {
      throw new TypeError(
        `tool(${name}, { ${field} }): unknown field '${field}'. The ` +
          `dictionary accepts ${OPTION_FIELDS.join(', ')}; input, output, ` +
          `errors and doc are taken from the operation.`,
      );
    }
  }
}

/**
 * Выводит имя инструмента из имени операции.
 *
 * Точки заменяются подчёркиваниями: протокол принимает имя из
 * `[a-zA-Z0-9_-]`, а имя операции по соглашению записывается через точку
 * (`users.create`).
 */
export function deriveToolName(operationName: string): string {
  return operationName.replaceAll('.', '_');
}

/**
 * Объявляет инструмент из операции.
 *
 * @param operation - Операция вида `request`; она даёт имя, схемы и отказы
 * @param options - Имя, описание и подсказки агенту
 * @returns Значение-объявление для списка `tools:` плагина `mcp(...)`
 * @throws {TypeError} Операция другого вида либо неизвестное поле словаря
 *
 * @example
 * ```typescript
 * mcp({
 *   server: { name: 'users-service', version: '1.0.0' },
 *   converters: [zodConverter()],
 *   tools: [
 *     tool(CreateUser, { annotations: { idempotentHint: false } }),
 *     tool(FindUsers, { annotations: { readOnlyHint: true } }),
 *   ],
 * });
 * ```
 */
export function tool<C extends AnyRequestOperation>(
  operation: C,
  options: McpToolOptions = {},
): DeclaredTool<C> {
  assertRequestOperation(operation);
  assertOptions(operation.name, options);

  const derived = options.name === undefined;
  const name = options.name ?? deriveToolName(operation.name);
  const description =
    options.description ??
    operation.doc?.description ??
    operation.doc?.summary;

  return {
    operation: operation as C,
    name,
    nameDerived: derived && name !== operation.name,
    ...(description === undefined ? {} : { description }),
    ...(options.annotations === undefined
      ? {}
      : { annotations: options.annotations }),
  };
}
