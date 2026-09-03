import { makeTokenFamily } from '@nestling/container';

export interface HealthCheck {
  readonly name: string;
  check(): Promise<string>;
}

/**
 * Семейство проверок здоровья.
 *
 * Каждый модуль регистрирует свою проверку под членским токеном
 * (`HealthCheck('database')`). Агрегатор инжектит `HealthCheck.all` и
 * получает массив всех вкладов, собранный на `build()`.
 */
export const HealthCheck = makeTokenFamily<HealthCheck, [name: string]>(
  'HealthCheck',
);
