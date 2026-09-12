/**
 * Построение определений инструментов из маршрутов транспорта.
 *
 * Источник состава — `dispatch.routes`: инструменты это endpoint'ы,
 * объявленные на транспорте MCP, и второго списка у пакета нет.
 *
 * Схемы переводятся в JSON Schema помощником ядра `leafJsonSchema` — тем
 * же, которым пользуется генератор OpenAPI. Конвертер приходит данными в
 * `converters:`, поэтому зависимости от валидатора у пакета нет.
 *
 * Нарушения копятся в {@link McpDiagnostics} и бросаются одним списком.
 */

import { McpDiagnostics, whereOf } from './diagnostics.js';
import { mcpBindingOf } from './tool.js';
import type { JsonValue, McpObjectSchema, McpToolDefinition } from './types.js';

import type { RouteDeclaration, SchemaDocConverter } from '@nestlingjs/app';
import { describeForm, leafJsonSchema } from '@nestlingjs/app';

/** Что построение определений получает помимо маршрутов */
export interface BuildOptions {
  /** Конвертеры листовых схем: список — данные вызывающего */
  readonly converters?: readonly SchemaDocConverter[];
}

/** Инструмент, готовый к вызову: определение для агента и его маршрут */
export interface BoundTool {
  /** Определение, которое уходит агенту в `tools/list` */
  readonly definition: McpToolDefinition;

  /** Паттерн декларации; им `dispatch.call` находит инструмент */
  readonly pattern: string;

  /** Проекция маршрута: формы io и объявленные отказы для контекста */
  readonly route: RouteDeclaration;

  /**
   * Объявлена ли схема выхода.
   *
   * Успешное значение уходит в `structuredContent` только тогда: клиент
   * проверяет поле объявленной схемой, и без неё структурированный ответ
   * проверять нечем.
   */
  readonly structured: boolean;
}

/** Схема выхода конвертера как объектная JSON Schema или ничто */
function asObjectSchema(json: unknown): McpObjectSchema | undefined {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return undefined;
  }

  const source = json as Record<string, unknown>;

  return source.type === 'object' ? (source as McpObjectSchema) : undefined;
}

/** Пустая схема входа: инструмент без `input` принимает вызов без аргументов */
function emptyObjectSchema(): McpObjectSchema {
  return { type: 'object', properties: {} };
}

/** Что получилось из перевода одного слота io */
type SlotOutcome =
  | { readonly outcome: 'object'; readonly schema: McpObjectSchema }
  | { readonly outcome: 'empty' }
  | { readonly outcome: 'not-object' }
  | { readonly outcome: 'failed' };

/**
 * Приводит вывод конвертера к JSON-значению.
 *
 * Отбрасываются `undefined` и функции: они не переживут `JSON.stringify`,
 * которым определение уходит агенту. Порядок ключей не меняется — его
 * задал автор схемы.
 */
function asJson(value: unknown): JsonValue {
  if (value === null || value === undefined) {
    return null;
  }

  if (Array.isArray(value)) {
    return value.map((item) => asJson(item));
  }

  switch (typeof value) {
    case 'boolean':
    case 'string': {
      return value;
    }
    case 'number': {
      return Number.isFinite(value) ? value : null;
    }
    case 'object': {
      const result: Record<string, JsonValue> = {};

      for (const [key, item] of Object.entries(
        value as Record<string, unknown>,
      )) {
        if (item === undefined || typeof item === 'function') {
          continue;
        }
        result[key] = asJson(item);
      }

      return result;
    }
    default: {
      return null;
    }
  }
}

/**
 * Переводит форму io в объектную JSON Schema.
 *
 * Нарушения перевода — отсутствие конвертера и непереводимая схема —
 * пишутся в копилку сразу: у них есть и координаты, и способ починки.
 * Решение, считать ли исход нарушением, принимает вызывающий: у входа
 * схема обязательна, у выхода нет.
 */
function convertSlot(
  io: unknown,
  slot: 'input' | 'output',
  where: string,
  options: BuildOptions,
  diagnostics: McpDiagnostics,
): SlotOutcome {
  const form = describeForm(io);

  if (form.kind !== 'value') {
    return { outcome: 'not-object' };
  }

  if (form.leaf === undefined) {
    return { outcome: 'empty' };
  }

  if (form.leaf === 'binary' || form.leaf === 'text') {
    return { outcome: 'not-object' };
  }

  let resolved: ReturnType<typeof leafJsonSchema>;

  try {
    resolved = leafJsonSchema(options.converters, form.leaf, { io: slot });
  } catch (error) {
    diagnostics.add(
      where,
      `its '${slot}' schema could not be converted to JSON Schema: ` +
        `${error instanceof Error ? error.message : String(error)}. ` +
        `Declare the schema explicitly with jsonSchema(schema, { … }), or ` +
        `replace the unrepresentable part of it.`,
    );
    return { outcome: 'failed' };
  }

  if (!resolved) {
    return { outcome: 'not-object' };
  }

  if (resolved.outcome === 'unconvertible') {
    diagnostics.add(
      where,
      `the '${slot}' schema is a '${resolved.vendor}' schema, and no ` +
        `converter for that vendor was passed. Either add one to ` +
        `'converters' (for example zodConverter() from ` +
        `@nestlingjs/schema.zod), or declare the schema explicitly with ` +
        `jsonSchema(schema, { … }).`,
    );
    return { outcome: 'failed' };
  }

  const schema = asObjectSchema(asJson(resolved.json));

  return schema === undefined
    ? { outcome: 'not-object' }
    : { outcome: 'object', schema };
}

/**
 * Строит определения инструментов и проверяет объявления.
 *
 * @param routes - Маршруты транспорта: `dispatch.routes`
 * @param options - Конвертеры схем
 * @returns Инструменты в порядке объявления
 * @throws {Error} Перечисление всех нарушений одним сообщением
 */
export function buildToolDefinitions(
  routes: readonly RouteDeclaration[],
  options: BuildOptions = {},
): BoundTool[] {
  const diagnostics = new McpDiagnostics();
  const built: BoundTool[] = [];

  for (const route of routes) {
    const where = whereOf(route.pattern);
    const { description, annotations } = mcpBindingOf(route);

    if (description === undefined || description === '') {
      diagnostics.add(
        where,
        `it has no description. An agent picks a tool by its description, ` +
          `so declare one in 'description' of the tool dictionary, in ` +
          `'doc.description' of the operation, or in 'doc.summary' of the ` +
          `operation.`,
      );
    }

    const input = convertSlot(
      route.input,
      'input',
      where,
      options,
      diagnostics,
    );

    if (input.outcome === 'not-object') {
      diagnostics.add(
        where,
        `its 'input' is not an object form, and the protocol requires an ` +
          `object schema for tool arguments. A stream, a multipart form and ` +
          `a primitive body cannot be passed as tool arguments.`,
      );
    }

    const output = convertSlot(
      route.output,
      'output',
      where,
      options,
      diagnostics,
    );

    built.push({
      pattern: route.pattern,
      route,
      structured: output.outcome === 'object',
      definition: {
        name: route.pattern,
        inputSchema:
          input.outcome === 'object' ? input.schema : emptyObjectSchema(),
        ...(description === undefined ? {} : { description }),
        ...(output.outcome === 'object' ? { outputSchema: output.schema } : {}),
        ...(annotations === undefined
          ? {}
          : { annotations: { ...annotations } }),
      },
    });
  }

  diagnostics.throwIfAny();

  return built;
}
