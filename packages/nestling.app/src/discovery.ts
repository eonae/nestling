import type { InjectionToken, Module } from '@nestling/container';
import { makeToken } from '@nestling/container';
import type { AnyEndpointDefinition, TransportRef } from '@nestling/pipeline';
import { isEndpointDefinition } from '@nestling/pipeline';

/**
 * Обнаруженный endpoint с атрибуцией к модулю-объявителю
 */
export interface DiscoveredEndpoint {
  /** Декларация-значение; `transport` и `pattern` читаются прямо с неё */
  endpoint: AnyEndpointDefinition;

  /** Имя модуля, объявившего endpoint в `endpoints:` */
  moduleName: string;
}

/**
 * Результат discovery: что обслуживает приложение и какие транспорты для
 * этого требуются.
 *
 * Значение **только для чтения** — и в типах, и в рантайме (`Object.freeze`
 * на списках и карте). Причина не в аккуратности: результат отдаётся графу
 * под токеном `Discovery$`, а инжектируемый discovery — поверхность
 * интроспекции, а не точка расширения. Состав приложения определяется
 * деревом модулей и `select`, и менять его из графа нельзя.
 */
export interface EndpointDiscovery {
  /** Endpoint'ы в детерминированном порядке обхода дерева модулей */
  readonly endpoints: readonly DiscoveredEndpoint[];

  /**
   * Требуемый транспорт → объявленные на нём endpoint'ы.
   *
   * Ключ — **токен** транспорта с декларации, а не строковое имя: по нему
   * же `App` берёт инстанс из собранного графа.
   */
  readonly transports: ReadonlyMap<TransportRef, readonly DiscoveredEndpoint[]>;
}

/**
 * Токен инжектируемого discovery: состав приложения как узел графа.
 *
 * Регистрируется `assemble` **всегда и без условий** — провайдер-значение
 * ничего не стоит, а его отсутствие делало бы satellite-модуль зависимым от
 * флага в корне. Значение то же самое, которое `App` вычисляет до
 * построения графа: второй discovery не выполняется.
 *
 * Это поверхность **интроспекции**, а не точка расширения: значение
 * заморожено, менять состав приложения из графа нельзя. Единственный способ
 * для модуля увидеть **выбранную** топологию целиком, не дублируя `select`
 * в корне.
 *
 * @example
 * ```typescript
 * providers: [
 *   factoryProvider(
 *     Report$,
 *     (discovery) => summarize(discovery.endpoints),
 *     [Discovery$],
 *   ),
 * ]
 * ```
 */
export const Discovery$: InjectionToken<EndpointDiscovery> =
  makeToken<EndpointDiscovery>('nestling:discovery');

/**
 * Обходит дерево модулей в том же порядке, что `ContainerBuilder.registerModule`:
 * depth-first, `imports` — до самого модуля, дедупликация **по значению**.
 *
 * Идентичность модуля — его значение: то же значение, встреченное повторно,
 * обходится один раз, а другое значение под занятым именем — ошибка, как в
 * контейнере. Молча пропустить одноимённый модуль значило бы потерять вместе
 * с ним его endpoint'ы — «обнаружено» разошлось бы с «собрано».
 *
 * Модуль помечается посещённым на входе, поэтому цикл в `imports`
 * (`A → B → A`) завершает обход, а не зацикливает его.
 */
function* visitModules(modules: readonly Module[]): Generator<Module> {
  const visited = new Map<string, Module>();

  function* visit(module: Module): Generator<Module> {
    const seen = visited.get(module.name);

    if (seen) {
      if (seen !== module) {
        throw new Error(
          `Two different modules are named '${module.name}'. ` +
            `A module name is the attribution key of its providers and endpoints, ` +
            `so it must be unique. Either share one module value between its consumers ` +
            `(create it once and import that value), or give the two configurations ` +
            `different names. If neither is the case, check for a duplicated package in ` +
            `your dependencies - two copies give two values of the same module.`,
        );
      }

      return;
    }
    visited.set(module.name, module);

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
 * Собирает endpoint'ы обходом дерева зарегистрированных модулей.
 *
 * Чистая функция: не требует DI-контейнера, транспортов и поднятия
 * приложения — источник истины о составе приложения виден тестам напрямую.
 *
 * @param modules - Модули, переданные приложению (вместе с транзитивными `imports`)
 * @returns Endpoint'ы с атрибуцией к модулю и карта требуемых транспортов
 * @throws {Error} Если элемент `endpoints:` не является декларацией endpoint'а
 *
 * @example
 * ```typescript
 * const { endpoints, transports } = discoverEndpoints([UsersModule]);
 * // endpoints[0].moduleName === 'module:users'
 * // transports.get(HttpTransport$)?.length === 9
 * ```
 */
export function discoverEndpoints(
  modules: readonly Module[],
): EndpointDiscovery {
  const endpoints: DiscoveredEndpoint[] = [];
  const transports = new Map<TransportRef, DiscoveredEndpoint[]>();

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

  // Заморозка — не церемония: это же значение попадает в граф под
  // `Discovery$`, и «поменять состав приложения из провайдера» должно быть
  // невозможно, а не просто не принято
  for (const group of transports.values()) {
    Object.freeze(group);
  }

  return Object.freeze({
    endpoints: Object.freeze(endpoints),
    transports: freezeMap(transports),
  });
}

/** Мутатор карты, подменённый броском с понятным сообщением */
const rejectMutation = (method: string) => (): never => {
  throw new TypeError(
    `Endpoint discovery is read-only: '${method}' would change what the ` +
      `application serves. The set of endpoints comes from the tree of ` +
      `registered modules (and 'select'), not from the graph.`,
  );
};

/**
 * Замораживает карту, отбирая у неё мутаторы.
 *
 * `Object.freeze` на `Map` не запрещает `set`/`delete` — состояние живёт во
 * внутреннем слоте, а не в свойствах. Поэтому мутаторы подменяются
 * броском: read-only обещан значением, а не соглашением.
 */
function freezeMap<K, V>(map: Map<K, V>): ReadonlyMap<K, V> {
  Object.defineProperties(map, {
    set: { value: rejectMutation('set') },
    delete: { value: rejectMutation('delete') },
    clear: { value: rejectMutation('clear') },
  });

  return Object.freeze(map);
}
