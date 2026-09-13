/**
 * `mcpTool` — конструктор деклараций инструмента.
 *
 * Форм две, как у каждого транспорта: `mcpTool(name, { … })` объявляет
 * инструмент вместе со схемами, `mcpTool.implement(operation, { … })`
 * обслуживает уже объявленную операцию. Обе возвращают обычную декларацию
 * endpoint'а: она кладётся в `endpoints:` фичи и получает discovery,
 * пайплайн, проверку отказов на выходе и `policies`.
 *
 * Имя инструмента — `pattern` декларации. Уникальность пары «экземпляр
 * транспорта, паттерн» проверяет ядро на BUILD, поэтому собственной
 * проверки имён пакету не нужно, а второго места, где хранилось бы имя,
 * не появляется.
 *
 * Описание и подсказки агенту едут в `binding`: проекция маршрута,
 * которую получает транспорт, секцию `doc` не несёт.
 */

import { McpTransport$ } from './token.js';
import type { McpToolAnnotations } from './types.js';

import type {
  AnyEndpointDefinition,
  AnyFail,
  AnyFailDefinition,
  AnyHandlerResult,
  AnyInput,
  AnyOutput,
  AnyPayload,
  CheckedHandlerFn,
  EndpointDefinition,
  FailsOf,
  HandlerClass,
  Pipeline,
  ValidateOutputForm,
} from '@nestlingjs/app';
import {
  assertLayerFailsDeclared,
  DEFAULT_INSTANCE,
  makeEndpoint,
} from '@nestlingjs/app';
import type {
  HandlerResultOf,
  InputFormOf,
  OperationFailsOf,
  OutputFormOf,
  RequestOperation,
  ValidateHandlerFails,
  ValidateOperationFails,
} from '@nestlingjs/operations';

/** Операция вида `request` с любыми схемами и отказами */
export type AnyRequestOperation = RequestOperation<any, any, any>;

/**
 * Имя инструмента, которое принимает протокол.
 *
 * Перечень записан посимвольно, а не через `\w`: `source` этого выражения
 * уходит в текст ошибки, и автор декларации читает там ту же запись,
 * какой требование записано в спецификации протокола.
 */
// eslint-disable-next-line unicorn/better-regex -- текст ошибки цитирует source
export const TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

/**
 * Данные инструмента, которых нет в проекции маршрута.
 *
 * Имени здесь нет: имя инструмента — `pattern` декларации, и второе поле с
 * тем же значением разошлось бы с ним при первой же правке.
 *
 * Описание объявлено необязательным, потому что его может не найтись ни в
 * словаре, ни в секции `doc` операции. Это нарушение, и сообщает его старт
 * транспорта — вместе с остальными, одним списком.
 */
export interface McpBinding {
  /** Описание для агента; по нему он выбирает инструмент */
  readonly description?: string;

  /** Подсказки агенту о характере инструмента */
  readonly annotations?: McpToolAnnotations;
}

/** Носитель биндинга: декларация или её проекция для транспорта */
export interface McpBindingBearer {
  readonly binding?: unknown;
}

/**
 * Читает данные инструмента с декларации или её проекции.
 *
 * Транспорт читает их с `RouteDeclaration`, автор декларации — с самой
 * декларации; обоим нужно одно поле.
 */
export function mcpBindingOf(bearer: McpBindingBearer): McpBinding {
  const carried: unknown = bearer.binding;

  if (typeof carried !== 'object' || carried === null) {
    return {};
  }

  const { description, annotations } = carried as McpBinding;

  return {
    ...(typeof description === 'string' ? { description } : {}),
    ...(annotations === undefined ? {} : { annotations }),
  };
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

/** Отвергает имя, которого протокол не принимает */
function assertToolName(where: string, name: unknown): asserts name is string {
  if (typeof name !== 'string' || !TOOL_NAME_PATTERN.test(name)) {
    throw new TypeError(
      `${where}: the tool name ${JSON.stringify(name)} does not match ` +
        `${TOOL_NAME_PATTERN.source}, which the protocol requires. Declare a ` +
        `name the protocol accepts.`,
    );
  }
}

/**
 * Транспортный словарь анонимной декларации.
 *
 * Легален и типизирован только здесь; пайплайн и хендлер остаются
 * транспорт-слепыми.
 */
export interface McpToolDictionary<
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
  P extends AnyInput = AnyInput,
  PN = never,
  E extends readonly AnyFailDefinition[] = [],
  PF extends AnyFail = never,
> {
  /**
   * Описание для агента: по нему он выбирает инструмент.
   *
   * Требование строже, чем у документа OpenAPI, намеренно: инструмент без
   * описания агент выбрать не может.
   */
  description: string;

  /** Форма io для input: аргументы вызова инструмента */
  input?: I;

  /** Форма io для output (см. `ValidateOutputForm`) */
  output?: O & ValidateOutputForm<O>;

  /**
   * Объявленные отказы инструмента. Транспорт поле не интерпретирует —
   * только пробрасывает в `makeEndpoint` (см. `httpEndpoint`).
   */
  errors?: E;

  /**
   * Подсказки агенту о характере инструмента.
   *
   * Значения объявляет автор: из схем они не выводятся.
   */
  annotations?: McpToolAnnotations;

  /**
   * Пайплайн этого инструмента. Классы-шаги допустимы: они попадают в
   * `TNeeds` декларации и гасятся вместе с зависимостями хендлера.
   */
  pipeline?: Pipeline<AnyInput, P, PN, PF>;

  /** Причина вывода инструмента из-под инвариантов сборки */
  detached?: string;

  /** Имя экземпляра транспорта; по умолчанию `'default'` */
  on?: string;
}

/**
 * Словарь реализации операции инструментом: только исполнение и то, что
 * нужно агенту.
 *
 * Схемы, отказы и секция `doc` берутся с операции. Полей, которыми владеет
 * операция, здесь нет вовсе: лишний ключ в объектном литерале TypeScript
 * отвергает и без объявления полей как `never`.
 */
export interface McpImplementDictionary<
  C extends AnyRequestOperation = AnyRequestOperation,
  P extends AnyInput = AnyInput,
  PN = never,
  PF extends AnyFail = never,
> {
  /**
   * Имя инструмента. Без него имя выводится из имени операции: точки
   * заменяются подчёркиваниями.
   */
  name?: string;

  /**
   * Описание для агента. Без него берётся `doc.description`, затем
   * `doc.summary` операции.
   */
  description?: string;

  /** Подсказки агенту о характере инструмента */
  annotations?: McpToolAnnotations;

  /**
   * Пайплайн декларации. Отказы, объявленные его слоями, обязаны входить в
   * `errors:` операции: контракт импортирует потребитель, и он о пайплайне
   * реализации не знает.
   */
  pipeline?: Pipeline<AnyInput, P, PN, PF> & ValidateOperationFails<C, PF>;

  /** Причина вывода инструмента из-под инвариантов сборки */
  detached?: string;

  /** Имя экземпляра транспорта; по умолчанию `'default'` */
  on?: string;
}

/** Поля, которые в реализации операции объявляет сама операция */
const OPERATION_OWNED = ['input', 'output', 'errors', 'doc'] as const;

/** Проверяет, что первым аргументом пришла операция вида `request` */
function assertRequestOperation(
  operation: unknown,
): asserts operation is AnyRequestOperation {
  const name = (operation as { name?: unknown } | undefined)?.name;
  const kind = (operation as { kind?: unknown } | undefined)?.kind;

  if (typeof name !== 'string' || typeof kind !== 'string') {
    throw new TypeError(
      `mcpTool.implement(operation, { … }): the first argument must be an ` +
        `operation value created by makeRequest.`,
    );
  }

  if (kind !== 'request') {
    throw new TypeError(
      `mcpTool.implement(${name}, { … }): the operation is of kind ` +
        `'${kind}', and a tool requires kind 'request'. A command and an ` +
        `event are delivered through an emitter and return no result the ` +
        `agent could read. Declare the operation with makeRequest.`,
    );
  }
}

/**
 * Отвергает поля операции, повторно объявленные в реализации.
 *
 * Словарь таких полей не знает, поэтому типы их не компилируют. Проверка
 * нужна для JavaScript, где переданное поле иначе молча игнорировалось бы.
 */
function assertOperationOwned(
  declaration: Record<string, unknown>,
  operation: AnyRequestOperation,
): void {
  for (const field of OPERATION_OWNED) {
    if (declaration[field] !== undefined) {
      throw new TypeError(
        `mcpTool.implement(${operation.name}, { … }): '${field}' belongs to ` +
          `the operation and cannot be redeclared by its implementation. ` +
          `The dictionary owns ${OPERATION_OWNED.join(', ')} through the ` +
          `operation itself.`,
      );
    }
  }
}

/**
 * Собирает данные инструмента для `binding`.
 *
 * Пустой биндинг не создаётся: декларация без описания и без подсказок
 * остаётся тем же значением, каким была бы без этого поля.
 */
function bindingOf(
  description: string | undefined,
  annotations: McpToolAnnotations | undefined,
): { binding: McpBinding } | Record<string, never> {
  if (description === undefined && annotations === undefined) {
    return {};
  }

  return {
    binding: {
      ...(description === undefined ? {} : { description }),
      ...(annotations === undefined ? {} : { annotations }),
    } satisfies McpBinding,
  };
}

/**
 * Объявляет инструмент вместе со схемами.
 *
 * @param name - Имя инструмента; оно же паттерн endpoint'а
 * @param declaration - Словарь инструмента: описание, формы io, пайплайн,
 * хендлер
 * @throws {TypeError} Имя не по шаблону протокола
 *
 * @example
 * ```typescript
 * export const SearchUsers = mcpTool('search_users', {
 *   description: 'Найти пользователей по подстроке в адресе почты.',
 *   annotations: { readOnlyHint: true },
 *   input: z.object({ query: z.string() }),
 *   output: z.object({ total: z.number() }),
 *   handler: SearchUsersHandler,
 * });
 * ```
 */
function declareTool<
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
  P extends AnyInput = AnyInput,
  PN = never,
  E extends readonly AnyFailDefinition[] = [],
  PF extends AnyFail = never,
  R extends AnyHandlerResult<O> = AnyHandlerResult<O>,
>(
  name: string,
  declaration: McpToolDictionary<I, O, P, PN, E, PF> & {
    handler: CheckedHandlerFn<I, P, FailsOf<E> | NoInfer<PF>, R>;
  },
): EndpointDefinition<I, O, P, PN>;
function declareTool<
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
  P extends AnyInput = AnyInput,
  PN = never,
  E extends readonly AnyFailDefinition[] = [],
  PF extends AnyFail = never,
  C extends HandlerClass<I, O, P, AnyFail> = HandlerClass<I, O, P, AnyFail>,
>(
  name: string,
  declaration: McpToolDictionary<I, O, P, PN, E, PF> & {
    handler: C &
      ValidateHandlerFails<HandlerResultOf<C>, FailsOf<E> | NoInfer<PF>>;
  },
): EndpointDefinition<I, O, P, PN | C>;
function declareTool(
  name: string,
  declaration: McpToolDictionary<
    any,
    any,
    any,
    unknown,
    readonly AnyFailDefinition[],
    AnyFail
  > & { handler: unknown },
): AnyEndpointDefinition {
  assertToolName(`mcpTool(${JSON.stringify(name)}, { … })`, name);

  const { on, annotations, description, ...rest } = declaration;

  return (makeEndpoint as (options: unknown) => AnyEndpointDefinition)({
    ...rest,
    transport: McpTransport$(on ?? DEFAULT_INSTANCE),
    pattern: name,
    ...bindingOf(description, annotations),
  });
}

/**
 * Объявляет инструмент из операции.
 *
 * Схемы, отказы и секция `doc` берутся с операции; словарь задаёт
 * исполнение и то, что нужно агенту. Результат — обычная декларация
 * endpoint'а.
 *
 * @param operation - Операция вида `request`
 * @param declaration - Словарь: имя, описание, подсказки, пайплайн, хендлер
 * @throws {TypeError} Операция другого вида, поле операции в словаре либо
 * имя не по шаблону протокола
 *
 * @example
 * ```typescript
 * export const CreateUserTool = mcpTool.implement(CreateUser, {
 *   annotations: { idempotentHint: false },
 *   handler: CreateUserHandler,
 * });
 * ```
 */
function implementOperation<
  C extends AnyRequestOperation,
  P extends AnyInput = AnyInput,
  PN = never,
  PF extends AnyFail = never,
  R extends AnyHandlerResult<OutputFormOf<C>> = AnyHandlerResult<
    OutputFormOf<C>
  >,
>(
  operation: C,
  declaration: McpImplementDictionary<C, P, PN, PF> & {
    handler: CheckedHandlerFn<InputFormOf<C>, P, OperationFailsOf<C>, R>;
  },
): EndpointDefinition<InputFormOf<C>, OutputFormOf<C>, P, PN>;
function implementOperation<
  C extends AnyRequestOperation,
  P extends AnyInput = AnyInput,
  PN = never,
  PF extends AnyFail = never,
  H extends HandlerClass<
    InputFormOf<C>,
    OutputFormOf<C>,
    P,
    AnyFail
  > = HandlerClass<InputFormOf<C>, OutputFormOf<C>, P, AnyFail>,
>(
  operation: C,
  declaration: McpImplementDictionary<C, P, PN, PF> & {
    handler: H & ValidateHandlerFails<HandlerResultOf<H>, OperationFailsOf<C>>;
  },
): EndpointDefinition<InputFormOf<C>, OutputFormOf<C>, P, PN | H>;
function implementOperation(
  operation: unknown,
  declaration: McpImplementDictionary<
    AnyRequestOperation,
    any,
    unknown,
    AnyFail
  > & { handler: unknown },
): AnyEndpointDefinition {
  assertRequestOperation(operation);

  const { on, name, annotations, description, ...rest } =
    declaration as unknown as Record<string, unknown> & {
      on?: string;
      name?: string;
      annotations?: McpToolAnnotations;
      description?: string;
    };

  assertOperationOwned(rest, operation);
  assertLayerFailsDeclared(
    rest.pipeline,
    operation.errors,
    `mcpTool.implement(${operation.name}, { … })`,
  );

  const pattern = name ?? deriveToolName(operation.name);

  assertToolName(`mcpTool.implement(${operation.name}, { … })`, pattern);

  return (makeEndpoint as (options: unknown) => AnyEndpointDefinition)({
    ...rest,
    transport: McpTransport$(on ?? DEFAULT_INSTANCE),
    pattern,
    input: operation.input,
    output: operation.output,
    errors: operation.errors,
    doc: operation.doc,
    ...bindingOf(
      description ?? operation.doc?.description ?? operation.doc?.summary,
      annotations,
    ),
  });
}

/**
 * Конструкторы деклараций инструмента.
 *
 * Значение, а не функция: анонимную форму создаёт вызов, реализацию
 * операции — `implement`. Форма повторяет `httpEndpoint`, поэтому автор
 * читает её так же, как декларацию любого другого транспорта.
 *
 * @example
 * ```typescript
 * const Search = mcpTool('search_users', { description, input, handler });
 * const Create = mcpTool.implement(CreateUser, { handler });
 * ```
 */
export const mcpTool: typeof declareTool & {
  implement: typeof implementOperation;
} = Object.assign(declareTool, { implement: implementOperation });
