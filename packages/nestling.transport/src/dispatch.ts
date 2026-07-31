/**
 * `Dispatch` — фазовый ресурс, разделяющий провод и исполнение.
 *
 * Транспорт получает его аргументом `serve(dispatch, signal)`, то есть в
 * фазе START. До этого момента исполнимых ручек у него нет вовсе: проекция
 * `routes` их не содержит, а `call` живёт здесь. «Ранний go-live» запрещён
 * не конвенцией, а тем, что вышедшему в эфир транспорту нечего
 * маршрутизировать.
 */

import type { Schema } from '@common/misc';
import type {
  AnyEndpointDefinition,
  AnyInput,
  EndpointDefinition,
  ExtendableContext,
  Pipeline,
  ResponseContext,
  UnknownFailInfo,
} from '@nestling/pipeline';
import { describeForm, isFail, Ok, parsePayload } from '@nestling/pipeline';

/**
 * Проекция декларации для транспорта: всё нужное для роутинга и парсинга,
 * без единого исполнимого поля.
 *
 * Разделение проходит не по времени передачи, а по составу: провод —
 * транспорту, исполнение — ядру. Поэтому `handle`, `pipeline`, `deps` и
 * `resolve` в проекции отсутствуют и в рантайме.
 */
export type RouteDeclaration = Omit<
  AnyEndpointDefinition,
  'handle' | 'pipeline' | 'deps' | 'resolve' | '$needs'
>;

/**
 * Свойства границы, с которыми транспорт просит исполнить ручку.
 *
 * Едут аргументом `call`, а не хранятся в `dispatch`: это политика
 * конкретного провода (терминал показывает stack, публичный HTTP — нет),
 * а не свойство таблицы маршрутов.
 */
export interface DispatchOptions {
  /** Раскрывать ли клиенту детали необработанных (не `Fail`) ошибок */
  exposeErrorDetails?: boolean;

  /** Диагностический хук стража границы */
  onUnknownFail?: (info: UnknownFailInfo) => void;
}

/**
 * Таблица маршрутов одного транспорта плюс исполнение ручки.
 *
 * Строится в фазе WIRE (`makeDispatch`) — после того, как зависимости
 * деклараций погашены контейнером; в START только передаётся транспорту.
 */
export interface Dispatch {
  /** Маршруты этого транспорта: роутинг + io-декларация для парсинга */
  readonly routes: readonly RouteDeclaration[];

  /**
   * Исполняет ручку: выбирает ветку «с pipeline / без pipeline» и
   * выполняет её.
   *
   * @throws {Error} Если `pattern` не принадлежит этому диспетчеру
   */
  call(
    pattern: string,
    ctx: ExtendableContext<AnyInput>,
    options?: DispatchOptions,
  ): Promise<ResponseContext>;
}

/**
 * Исполнимая декларация: `TNeeds = never` (см. `EndpointDefinition`).
 *
 * Параметры io намеренно `any`: `makeDispatch` собирает разнородные ручки в
 * одну таблицу, и единственное, что он о них требует, — исполнимость.
 */
export type ExecutableDeclaration = EndpointDefinition<any, any, any, never>;

/**
 * Строит проекцию декларации: перечислимые не-исполнимые поля.
 *
 * Копия, а не ссылка на декларацию: транспорт не должен иметь способа
 * добраться до `handle` даже через прототип или спред.
 */
export const toRouteDeclaration = (
  definition: AnyEndpointDefinition,
): RouteDeclaration => {
  const route: Record<string, unknown> = {
    transport: definition.transport,
    pattern: definition.pattern,
  };

  if (definition.input !== undefined) {
    route.input = definition.input;
  }
  if (definition.output !== undefined) {
    route.output = definition.output;
  }
  if (definition.binding !== undefined) {
    route.binding = definition.binding;
  }
  if (definition.errors !== undefined) {
    route.errors = definition.errors;
  }

  return Object.freeze(route) as RouteDeclaration;
};

/** Ветка «без pipeline»: одна на все транспорты */
const callDirectly = async (
  definition: AnyEndpointDefinition,
  ctx: ExtendableContext<AnyInput>,
): Promise<ResponseContext> => {
  const inputForm = describeForm(definition.input);

  // Value-форма со схемой-листом валидируется здесь: без пайплайна
  // `validate()`-юнита нет, а контракт ручки обязан соблюдаться на обоих
  // путях исполнения.
  const payload =
    inputForm.kind === 'value' &&
    inputForm.leaf &&
    inputForm.leaf !== 'binary' &&
    inputForm.leaf !== 'text'
      ? parsePayload(inputForm.leaf as Schema, {
          payload: ctx.raw.payload as Record<string, unknown>,
          metadata: {},
        })
      : ctx.raw.payload;

  // Без пайплайна в meta только зарезервированные ключи
  const result = await definition.handle(payload, {
    signal: ctx.signal,
    fail: (error: never): never => {
      throw error;
    },
  });

  // Возврат отказа эквивалентен броску: стража границы здесь нет, поэтому
  // отказ уходит той же дорогой, что и брошенный — иначе он уехал бы
  // клиенту телом успешного ответа.
  if (isFail(result)) {
    throw result;
  }

  return result instanceof Ok
    ? {
        isSuccess: true,
        status: result.status,
        value: result.value,
        headers: result.headers,
      }
    : { isSuccess: true, status: 'OK', value: result };
};

/**
 * Собирает диспетчер одного транспорта из его **исполнимых** деклараций.
 *
 * Принимает только `TNeeds = never`: декларация с непогашенными
 * зависимостями сюда не проходит по типам — сначала
 * `endpoint.resolve(resolver)` (под `App` это делает фаза WIRE).
 *
 * @param endpoints - Исполнимые декларации одного транспорта
 * @returns Диспетчер: проекции маршрутов и исполнение по паттерну
 *
 * @example
 * ```typescript
 * const controller = new AbortController();
 * await transport.serve(makeDispatch([Ping]), controller.signal);
 * ```
 */
export function makeDispatch(
  endpoints: readonly ExecutableDeclaration[],
): Dispatch {
  const table = new Map<string, AnyEndpointDefinition>();
  const routes: RouteDeclaration[] = [];

  for (const definition of endpoints) {
    const existing = table.get(definition.pattern);
    if (existing) {
      throw new Error(
        `Dispatch already has a route for pattern '${definition.pattern}'. ` +
          `Two endpoint declarations of one transport cannot share a pattern.`,
      );
    }

    table.set(definition.pattern, definition);
    routes.push(toRouteDeclaration(definition));
  }

  return {
    routes: Object.freeze(routes),

    async call(pattern, ctx, options = {}) {
      const definition = table.get(pattern);

      if (!definition) {
        throw new Error(
          `Dispatch has no route for pattern '${pattern}'. ` +
            `Known patterns: ${[...table.keys()].join(', ') || '(none)'}`,
        );
      }

      const pipeline = definition.pipeline as
        | Pipeline<AnyInput, AnyInput, never>
        | undefined;

      if (!pipeline) {
        return await callDirectly(definition, ctx);
      }

      return await pipeline.executeWithHandler(definition.handle, ctx, options);
    },
  };
}
