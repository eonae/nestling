/**
 * `@nestling/testing` — тестовый composition root.
 *
 * Пакет тонкий по построению: тестируемость здесь следствие архитектуры,
 * а не машинерии пакета. Раннера, матчеров и snapshot-механики он не
 * вводит — jest остаётся jest'ом.
 *
 * Строковой формы доступа к токену (`overrideByName('…')`) в экспорте нет
 * и не будет: это дыра в ES-видимости и обесценивание kernel/user-границы.
 */

export { assembleTest, TestApp } from './app.js';
export type { TestAssemblySpec, TestCallOptions, TestStub } from './app.js';
export { vars } from './config.js';
export type { TestConfig } from './config.js';
export { contextValue } from './context.js';
export { testModule } from './module.js';
export type { TestModuleOptions } from './module.js';
export { familyOverride } from './overrides.js';
export type { TestOverride } from './overrides.js';
export { checkTopologies } from './topologies.js';
export type { TopologyReport } from './topologies.js';
export { unwrap, UnwrapFailedError } from './unwrap.js';

/**
 * Отчёт `App.check()` — реэкспорт типа: матрица топологий возвращает его,
 * и тест не должен ради одной аннотации импортировать `@nestling/app`.
 */
export type { CheckReport } from '@nestling/app';
