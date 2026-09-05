/**
 * `Dispatch` — фазовый ресурс, разделяющий то, что уходит по сети, и
 * исполнение.
 *
 * Транспорт получает его аргументом `serve(dispatch, signal)`, то есть в
 * фазе START. До этого момента исполнимых endpoint'ов у него нет вовсе:
 * проекция `routes` их не содержит, а `call` живёт здесь. «Ранний старт
 * приёма запросов» запрещён не конвенцией, а тем, что транспорту, уже
 * начавшему принимать запросы, нечего маршрутизировать.
 */

import type {
  AnyEndpointDefinition,
  AnyInput,
  EndpointDefinition,
  ExtendableContext,
  Pipeline,
  ResponseContext,
  UnknownFailInfo,
} from '@nestling/pipeline';
import { makePipeline } from '@nestling/pipeline';

/**
 * Проекция декларации для транспорта: всё нужное для роутинга и парсинга,
 * без единого исполнимого поля.
 *
 * Разделение проходит не по времени передачи, а по составу: транспорту —
 * то, что уходит по сети, исполнение — ядру. Поэтому `handler`, `handle`,
 * `pipeline` и `resolve` в проекции отсутствуют и в рантайме.
 */
export type RouteDeclaration = Omit<
  AnyEndpointDefinition,
  'handle' | 'handler' | 'pipeline' | 'resolve' | '$needs'
>;

/**
 * Свойства границы, с которыми транспорт просит исполнить endpoint.
 *
 * Передаются аргументом `call`, а не хранятся в `dispatch`: это политика
 * конкретного транспорта (терминал показывает stack, публичный HTTP —
 * нет), а не свойство таблицы маршрутов.
 */
export interface DispatchOptions {
  /** Раскрывать ли клиенту детали необработанных (не `Fail`) ошибок */
  exposeErrorDetails?: boolean;

  /** Диагностический хук на отказ, которого нет в объявленных `errors:` */
  onUnknownFail?: (info: UnknownFailInfo) => void;
}

/**
 * Таблица маршрутов одного транспорта плюс исполнение endpoint'а.
 *
 * Строится в фазе WIRE (`makeDispatch`) после того, как зависимости
 * деклараций резолвены контейнером. В START диспетчер только передаётся
 * транспорту.
 */
export interface Dispatch {
  /** Маршруты этого транспорта: роутинг + io-декларация для парсинга */
  readonly routes: readonly RouteDeclaration[];

  /**
   * Исполняет endpoint рантаймом пайплайна.
   *
   * Декларация без `pipeline` исполняется тем же рантаймом с пустым
   * пайплайном, поэтому проверка входа, проверка ответа по `errors:` и
   * область контекста запроса работают одинаково у любого endpoint'а.
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
 * Параметры io намеренно `any`: `makeDispatch` собирает разнородные
 * endpoint'ы в одну таблицу, и единственное, что он о них требует, —
 * исполнимость.
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

/**
 * Пайплайн без единого юнита: им исполняется декларация без `pipeline`.
 *
 * Точка исполнения endpoint'а одна, поэтому проверка входа, проверка
 * ответа по `errors:` и область контекста запроса достаются такой
 * декларации тем же кодом, что и остальным.
 */
const emptyPipeline = makePipeline() as Pipeline<AnyInput, AnyInput, never>;

/**
 * Собирает диспетчер одного транспорта из его **исполнимых** деклараций.
 *
 * Принимает только `TNeeds = never`: декларация с нерезолвенными
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

      const pipeline =
        (definition.pipeline as Pipeline<AnyInput, AnyInput, never>) ??
        emptyPipeline;

      // Промис возвращается как есть: `return await` добавил бы тик
      // микротасков на каждый запрос, а стек ошибки он не улучшает
      return pipeline.executeWithHandler(definition.handle, ctx, options);
    },
  };
}
