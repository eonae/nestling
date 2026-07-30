import type { Module } from '@nestling/container';
import type { AnyEndpointDefinition } from '@nestling/pipeline';
import { isEndpointDefinition } from '@nestling/pipeline';

/**
 * Обнаруженный эндпоинт с атрибуцией к модулю-объявителю
 */
export interface DiscoveredEndpoint {
  /** Декларация-значение; `transport` и `pattern` читаются прямо с неё */
  endpoint: AnyEndpointDefinition;

  /** Имя модуля, объявившего эндпоинт в `endpoints:` */
  moduleName: string;
}

/**
 * Результат дискавери: что обслуживает приложение и какие транспорты для
 * этого требуются
 */
export interface EndpointDiscovery {
  /** Эндпоинты в детерминированном порядке обхода дерева модулей */
  endpoints: DiscoveredEndpoint[];

  /** Требуемый транспорт → объявленные на нём эндпоинты */
  transports: Map<string, DiscoveredEndpoint[]>;
}

/**
 * Обходит дерево модулей в том же порядке, что `ContainerBuilder.registerModule`:
 * depth-first, `imports` — до самого модуля, дедупликация по имени модуля.
 *
 * Модуль помечается посещённым на входе, поэтому цикл в `imports`
 * (`A → B → A`) завершает обход, а не зацикливает его.
 */
function* visitModules(modules: readonly Module[]): Generator<Module> {
  const visited = new Set<string>();

  function* visit(module: Module): Generator<Module> {
    if (visited.has(module.name)) {
      return;
    }
    visited.add(module.name);

    for (const imported of module.imports ?? []) {
      yield* visit(imported);
    }

    yield module;
  }

  for (const module of modules) {
    yield* visit(module);
  }
}

/**
 * Читает поле `endpoints` структурно — с любого значения-модуля, а не только
 * с результата `makeAppModule`: модуль, собранный вручную через `makeModule`,
 * тоже обнаруживается.
 */
function readDeclaredEndpoints(module: Module): unknown[] {
  const declared = (module as { endpoints?: unknown }).endpoints;
  return Array.isArray(declared) ? (declared as unknown[]) : [];
}

/** Краткое описание значения для текстов ошибок (там может быть что угодно) */
function describeValue(value: unknown): string {
  if (typeof value === 'function') {
    return value.name ? `class/function '${value.name}'` : 'a function';
  }
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'object') {
    const name = value.constructor?.name;
    return name && name !== 'Object' ? `an instance of '${name}'` : 'an object';
  }
  return `${typeof value} (${String(value)})`;
}

/**
 * Собирает эндпоинты обходом дерева зарегистрированных модулей.
 *
 * Чистая функция: не требует DI-контейнера, транспортов и поднятия
 * приложения — источник истины о составе приложения виден тестам напрямую.
 *
 * @param modules - Модули, переданные приложению (вместе с транзитивными `imports`)
 * @returns Эндпоинты с атрибуцией к модулю и карта требуемых транспортов
 * @throws {Error} Если элемент `endpoints:` не является декларацией endpoint'а
 *
 * @example
 * ```typescript
 * const { endpoints, transports } = discoverEndpoints([UsersModule]);
 * // endpoints[0].moduleName === 'module:users'
 * // transports.get('http')?.length === 9
 * ```
 */
export function discoverEndpoints(
  modules: readonly Module[],
): EndpointDiscovery {
  const endpoints: DiscoveredEndpoint[] = [];
  const transports = new Map<string, DiscoveredEndpoint[]>();

  for (const module of visitModules(modules)) {
    const seen = new Set<unknown>();

    const declared = readDeclaredEndpoints(module);
    for (const [index, endpoint] of declared.entries()) {
      // Декларация — значение: без бренда опечатка (положили сервис вместо
      // декларации) всплыла бы как undefined в рантайме транспорта
      if (!isEndpointDefinition(endpoint)) {
        throw new Error(
          `'endpoints:' of module '${module.name}' contains ` +
            `${describeValue(endpoint)} at index ${index}, which is not an ` +
            `endpoint declaration. Declare it with a transport constructor ` +
            `(httpEndpoint, cliEndpoint) and put the resulting value here.`,
        );
      }

      // Повтор одной декларации внутри модуля — одна регистрация
      if (seen.has(endpoint)) {
        continue;
      }
      seen.add(endpoint);

      const discovered: DiscoveredEndpoint = {
        endpoint,
        moduleName: module.name,
      };

      endpoints.push(discovered);

      const group = transports.get(endpoint.transport);
      if (group) {
        group.push(discovered);
      } else {
        transports.set(endpoint.transport, [discovered]);
      }
    }
  }

  return { endpoints, transports };
}
