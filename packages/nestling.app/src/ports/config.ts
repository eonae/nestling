/**
 * Секция конфигурации портов из ядра.
 *
 * Политика диспатча — конфиг, а не код: смена политики не меняет ни
 * одного call-site, а поля `dispatch:` в словаре `assemble` не
 * существует — перечень полей корня закрыт. Секцию переключают обычным
 * механизмом: привязанным источником или `vars()` в тестовом корне, а не
 * отдельным `load`, который до сборки контейнера читает единственный
 * источник — `env`.
 *
 * Токен секции наружу не экспортируется: граница ядра держится
 * видимостью ES-модулей, снаружи доступен только `.keys`.
 */

import type { StandardSchemaV1 } from '@common/misc';
import { makeConfig } from '@nestling/config';

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

/** Допустимые значения — тем же значением их перечисляет текст ошибки */
const POLICIES: readonly DispatchPolicy[] = ['local-first', 'always-remote'];

/**
 * Схема поля `dispatch` — написана руками.
 *
 * Standard Schema это интерфейс, а не библиотека: ядру не нужен вендор,
 * чтобы объявить перечисление из двух значений (тот же приём, что у
 * отказов ядра в пайплайне).
 */
const dispatchSchema: StandardSchemaV1<unknown, DispatchPolicy> = {
  '~standard': {
    version: 1,
    vendor: 'nestling',
    validate: (value) => {
      if (value === undefined || value === null || value === '') {
        return { value: 'local-first' };
      }

      return POLICIES.includes(value as DispatchPolicy)
        ? { value: value as DispatchPolicy }
        : {
            issues: [
              {
                message:
                  `Expected one of ${POLICIES.map((p) => `'${p}'`).join(', ')}, ` +
                  `got ${JSON.stringify(value)}`,
              },
            ],
          };
    },
  },
};

/**
 * Секция конфигурации портов: `NESTLING_PORTS_DISPATCH`.
 *
 * @internal Инжектится рецептами вызывателей; наружу отдаётся только `.keys`
 */
export const NestlingPortsConfig = makeConfig('nestlingPorts', {
  dispatch: dispatchSchema,
});

/** Ключи секции — то, что пакет отдаёт наружу для `config:` в корне */
export const portsConfigKeys = NestlingPortsConfig.keys;

/** Проекция секции портов */
export interface PortsConfig {
  readonly dispatch: DispatchPolicy;
}
