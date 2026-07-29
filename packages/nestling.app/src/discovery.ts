import type { Constructor } from '@common/misc';
import type { Module, Provider } from '@nestling/container';
import type { EndpointMetadata, IEndpoint } from '@nestling/pipeline';
import { getEndpointMetadata } from '@nestling/pipeline';

/** Конструктор endpoint-класса, объявляемый в `endpoints:` модуля */
export type EndpointClass = Constructor<IEndpoint<any, any, any>>;

/**
 * Обнаруженный эндпоинт с атрибуцией к модулю-объявителю
 */
export interface DiscoveredEndpoint {
  /** Конструктор endpoint-класса */
  endpoint: EndpointClass;

  /** Метаданные, записанные декоратором `@Endpoint`/`@HttpEndpoint` */
  metadata: EndpointMetadata;

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
function readDeclaredEndpoints(module: Module): EndpointClass[] {
  const declared = (module as { endpoints?: unknown }).endpoints;
  return Array.isArray(declared) ? (declared as EndpointClass[]) : [];
}

/** Имя класса для текстов ошибок (значение может быть чем угодно) */
function describeClass(value: unknown): string {
  return typeof value === 'function' && value.name ? value.name : String(value);
}

/**
 * Собирает эндпоинты обходом дерева зарегистрированных модулей.
 *
 * Чистая функция: не требует DI-контейнера, транспортов и поднятия
 * приложения — источник истины о составе приложения виден тестам напрямую.
 *
 * @param modules - Модули, переданные приложению (вместе с транзитивными `imports`)
 * @returns Эндпоинты с атрибуцией к модулю и карта требуемых транспортов
 * @throws {Error} Если класс в `endpoints:` не несёт метаданных эндпоинта
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
    const seen = new Set<EndpointClass>();

    for (const endpoint of readDeclaredEndpoints(module)) {
      // Повтор одного класса внутри модуля — одна регистрация
      if (seen.has(endpoint)) {
        continue;
      }
      seen.add(endpoint);

      const metadata = getEndpointMetadata(endpoint);
      if (!metadata) {
        throw new Error(
          `Endpoint class '${describeClass(endpoint)}' is declared in 'endpoints:' ` +
            `of module '${module.name}', but has no endpoint metadata. ` +
            `Decorate it with @Endpoint or @HttpEndpoint.`,
        );
      }

      const discovered: DiscoveredEndpoint = {
        endpoint,
        metadata,
        moduleName: module.name,
      };

      endpoints.push(discovered);

      const group = transports.get(metadata.transport);
      if (group) {
        group.push(discovered);
      } else {
        transports.set(metadata.transport, [discovered]);
      }
    }
  }

  return { endpoints, transports };
}

/**
 * Проверяет, что ни один класс с метаданными эндпоинта не остался вне
 * `endpoints:`: иначе ручка молча не обслуживается.
 *
 * Провайдеры, порождаемые `ProvidersFactory` (модуль объявил `providers`
 * функцией), до `build()` не видны и этой проверке не подлежат.
 *
 * @param modules - Модули приложения
 * @param providers - Корневые провайдеры `AppConfig`
 * @throws {Error} Если endpoint-класс объявлен провайдером, но не в `endpoints:`
 */
export function assertEndpointsDeclared(
  modules: readonly Module[],
  providers: readonly Provider[] = [],
): void {
  const tree = [...visitModules(modules)];

  const declared = new Set<unknown>();
  for (const module of tree) {
    for (const endpoint of readDeclaredEndpoints(module)) {
      declared.add(endpoint);
    }
  }

  const check = (provider: unknown, where: string): void => {
    if (typeof provider !== 'function' || declared.has(provider)) {
      return;
    }

    const metadata = getEndpointMetadata(provider);
    if (!metadata) {
      return;
    }

    throw new Error(
      `Endpoint class '${describeClass(provider)}' is registered as a provider ` +
        `in ${where}, but is not declared in 'endpoints:' of any module — ` +
        `handler '${metadata.pattern}' would never be served. ` +
        `Add it to the 'endpoints:' array of its module.`,
    );
  };

  for (const module of tree) {
    // ProvidersFactory разворачивается билдером — до build() её содержимое неизвестно
    if (typeof module.providers === 'function') {
      continue;
    }

    for (const provider of module.providers ?? []) {
      check(provider, `module '${module.name}'`);
    }
  }

  for (const provider of providers) {
    check(provider, "the app's root providers");
  }
}
