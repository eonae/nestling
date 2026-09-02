import type { Bundle } from './feature.js';

import type { InjectionToken } from '@nestling/container';
import { makeToken } from '@nestling/container';
import type { AnyEndpointDefinition, TransportRef } from '@nestling/pipeline';
import { isEndpointDefinition } from '@nestling/pipeline';

/**
 * Обнаруженный endpoint с атрибуцией к объявившей единице
 */
export interface DiscoveredEndpoint {
  /** Декларация-значение; `transport` и `pattern` читаются прямо с неё */
  endpoint: AnyEndpointDefinition;

  /** Имя фичи или плагина, объявившего endpoint в `endpoints:` */
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
 * списками `features` и `plugins` и полем `select`, и менять его из графа
 * нельзя.
 */
export interface EndpointDiscovery {
  /** Endpoint'ы в порядке объявления единиц */
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
 * ничего не стоит, а его отсутствие делало бы плагин зависимым от флага в
 * корне. Значение то же самое, которое `App` вычисляет до построения
 * графа: второй discovery не выполняется.
 *
 * Это поверхность **интроспекции**, а не точка расширения: значение
 * заморожено, менять состав приложения из графа нельзя. Единственный способ
 * для плагина увидеть **выбранную** топологию целиком, не дублируя `select`
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
 * Собирает endpoint'ы плоским проходом по фичам и плагинам.
 *
 * Обхода дерева со своей дедупликацией здесь нет и не нужно: endpoint'ы
 * объявляет единица, а не модуль, и список единиц уже плоский. Функция
 * чистая: не требует DI-контейнера, транспортов и поднятия приложения —
 * источник истины о составе приложения виден тестам напрямую.
 *
 * @param bundles - Выбранные фичи и подключённые плагины
 * @returns Endpoint'ы с атрибуцией к единице и карта требуемых транспортов
 * @throws {Error} Если элемент `endpoints:` не является декларацией
 * endpoint'а или две единицы названы одинаково
 *
 * @example
 * ```typescript
 * const { endpoints, transports } = discoverEndpoints([UsersFeature]);
 * // endpoints[0].moduleName === 'users'
 * ```
 */
export function discoverEndpoints(
  bundles: readonly Bundle[],
): EndpointDiscovery {
  const endpoints: DiscoveredEndpoint[] = [];
  const transports = new Map<TransportRef, DiscoveredEndpoint[]>();
  const declared = new Map<string, Bundle>();

  for (const bundle of bundles) {
    const seenBundle = declared.get(bundle.name);

    if (seenBundle) {
      if (seenBundle !== bundle) {
        throw new Error(
          `Two different ${bundle.role}s are named '${bundle.name}'. ` +
            `The name attributes endpoints and providers to their unit, so it ` +
            `must be unique. Share one value between its consumers, or give ` +
            `the two configurations different names.`,
        );
      }

      continue;
    }
    declared.set(bundle.name, bundle);

    const seen = new Set<unknown>();

    for (const [index, endpoint] of bundle.endpoints.entries()) {
      // Декларация — значение: без бренда опечатка (положили сервис вместо
      // декларации) всплыла бы как undefined в рантайме транспорта
      if (!isEndpointDefinition(endpoint)) {
        throw new Error(
          `'endpoints:' of ${bundle.role} '${bundle.name}' contains ` +
            `${describeValue(endpoint)} at index ${index}, which is not an ` +
            `endpoint declaration. Declare it with a transport constructor ` +
            `(httpEndpoint, cliEndpoint, implement) and put the resulting ` +
            `value here.`,
        );
      }

      // Повтор одной декларации внутри единицы — одна регистрация
      if (seen.has(endpoint)) {
        continue;
      }
      seen.add(endpoint);

      const discovered: DiscoveredEndpoint = {
        endpoint,
        moduleName: bundle.name,
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
      `application serves. The set of endpoints comes from the declared ` +
      `features and plugins (and 'select'), not from the graph.`,
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
