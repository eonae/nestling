/**
 * Kernel-секция конфигурации портов.
 *
 * Политика диспатча — **конфиг, а не код**: смена политики не меняет ни
 * одного call-site, и поля `dispatch:` в словаре `assemble` не существует —
 * перечень полей корня закрыт. Секция читается обычным механизмом (то есть
 * переключается и привязанным источником, и `vars()` в тестовом корне), а
 * не примордиальным `load`, который знает единственный источник — `env`.
 *
 * Токен секции наружу не экспортируется: kernel-граница держится
 * видимостью ES-модулей, снаружи доступен только `.keys`.
 */

import type { StandardSchemaV1 } from '@common/misc';
import { makeConfig } from '@nestling/config';

/**
 * Политика диспатча.
 *
 * - `local-first` — co-located реализация зовётся через `dispatch` шины;
 * - `always-remote` — вызов уходит через шину даже для co-located
 *   реализации: async-барьер, структурная копия и валидация ответа, то есть
 *   репетиция split'а в dev и в тестах.
 *
 * `balanced` (client-side spill) требует решения в рантайме и метрик,
 * которых без настоящей remote-шины не существует, — он приедет вместе с
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
 * kernel-отказов пайплайна).
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
