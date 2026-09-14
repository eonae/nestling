/**
 * Секция конфигурации портов из ядра.
 *
 * Политика диспатча — конфиг, а не код: смена политики не меняет ни
 * одного call-site, а поля `dispatch:` в словаре `build` не
 * существует — перечень полей корня закрыт. Секцию переключают обычным
 * механизмом: привязанным источником или `vars()` в тестовом корне, а не
 * отдельным `load`, который до сборки контейнера читает единственный
 * источник — `env`.
 *
 * DI-токен секции наружу не экспортируется: граница ядра держится
 * видимостью ES-модулей, снаружи доступен только `.keys`.
 */

import type {
  ConfigKeys,
  ConfigReader,
  ConfigSectionToken,
  ConfigValues,
} from '../config/index.js';
import { makeConfig, readSectionSnapshot } from '../config/index.js';

import { z } from 'zod';

/**
 * Политика диспатча.
 *
 * - `local-first` — co-located реализация вызывается через `dispatch`
 *   шины;
 * - `always-remote` — вызов уходит через шину даже для co-located
 *   реализации: async-барьер, структурная копия и проверка ответа. Вызов
 *   ведёт себя так же, как в split-развёртывании, уже в dev и в тестах.
 *
 * `balanced` (client-side spill) требует решения в рантайме и метрик,
 * которых без настоящей remote-шины не существует. Он появится вместе с
 * ней и call-site не изменит.
 */
export type DispatchPolicy = 'local-first' | 'always-remote';

/** Допустимые значения; `satisfies` сторожит совпадение с типом политики */
const POLICIES = [
  'local-first',
  'always-remote',
] as const satisfies readonly DispatchPolicy[];

/** Префикс секции: из него собираются и ключ, и имя в снимке фазы 0 */
const NESTLING_PORTS_PREFIX = 'nestlingPorts';

/**
 * Секция конфигурации портов: `NESTLING_PORTS_DISPATCH`.
 *
 * @internal Наружу отдаётся только `.keys`
 */
export const NestlingPortsConfig: ConfigSectionToken<
  ConfigValues<
    {
      dispatch: z.ZodDefault<
        z.ZodEnum<{
          'local-first': 'local-first';
          'always-remote': 'always-remote';
        }>
      >;
    },
    Record<never, never>
  >,
  'nestlingPorts'
> = makeConfig(NESTLING_PORTS_PREFIX, {
  dispatch: z.enum(POLICIES).default('local-first'),
});

/** Ключи секции — то, что пакет отдаёт наружу для `config:` в корне */
export const portsConfigKeys: ConfigKeys<'nestlingPorts'> =
  NestlingPortsConfig.keys;

/** Проекция секции портов */
export interface PortsConfig {
  readonly dispatch: DispatchPolicy;
}

/**
 * Читает политику из снимка фазы 0 — мимо графа.
 *
 * Зовётся корнем до построения контейнера. Политика — вход биндинга, а
 * путь вызывателя выбирает рецепт семейства, которому узлы графа
 * недоступны. Тем же приёмом читает свою секцию корневой логгер.
 *
 * Способ настройки от этого не меняется: та же секция, тот же ключ, те же
 * источники.
 *
 * @param reader - Читалка со снимком фазы 0
 * @returns Политика диспатча этой сборки
 * @internal
 */
export const readDispatchPolicy = (reader: ConfigReader): DispatchPolicy =>
  readSectionSnapshot<PortsConfig>(NESTLING_PORTS_PREFIX, reader).dispatch;
