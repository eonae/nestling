import { makeTokenFamily } from '@nestling/container';

export interface IHealthCheck {
  readonly name: string;
  check(): Promise<string>;
}

/**
 * Семейство вкладов: каждый модуль регистрирует свой check обычным провайдером
 * с членским токеном (`IHealthCheck('database')`), не трогая никакого
 * центрального списка. Агрегатор инжектит `IHealthCheck.all` и состава не знает
 * — билдер собирает массив на `build()`.
 */
export const IHealthCheck = makeTokenFamily<IHealthCheck, [name: string]>(
  'HealthCheck',
);
