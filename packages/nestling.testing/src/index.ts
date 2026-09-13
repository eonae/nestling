/**
 * `@nestlingjs/testing` — тестовый composition root.
 *
 * Пакет тонкий по построению: тестируемость здесь следствие архитектуры,
 * а не механизма пакета. Раннера, матчеров и snapshot-механики он не
 * вводит — jest остаётся jest'ом.
 *
 * Строковой формы доступа к DI-токену (`overrideByName('…')`) в экспорте нет
 * и не будет: это дыра в ES-видимости и обесценивание kernel/user-границы.
 */

export { buildTest, TestApp } from './app.js';
export type {
  EmitDelivery,
  TestBuildOptions,
  TestCallOptions,
  TestStub,
} from './app.js';
export { vars } from './config.js';
export { contextValue } from './context.js';
export { testBundle } from './bundle.js';
export type { TestBundleOptions } from './bundle.js';
export { spyLogger } from './logger.js';
export type { LogEntry, SpyLogger } from './logger.js';
export { spyMetrics } from './metrics.js';
export type { MetricRecord, SpyMetrics } from './metrics.js';
export { familyOverride } from './overrides.js';
export type { TestOverride } from './overrides.js';
export { stub } from './stub.js';
export type {
  OperationStub,
  EmitStubImpl,
  RequestStubImpl,
  StubOutput,
} from './stub.js';
export { checkTopologies } from './topologies.js';
export type { TopologyReport } from './topologies.js';
export { unwrap, UnwrapFailedError } from './unwrap.js';

/**
 * Отчёт `app.check()` и его опции — реэкспорт типов: матрица топологий
 * их принимает и возвращает, и тест не должен ради одной аннотации
 * импортировать `@nestlingjs/app`.
 */
export type { CheckOptions, CheckReport } from '@nestlingjs/app';

/**
 * Снапшот и дифф операций — реэкспорт из `@nestlingjs/app`.
 *
 * CI-тест матрицы («собери снапшот, сравни с baseline, напечатай отчёт»)
 * пишется одним импортом: топологии, сведение и сравнение живут в разных
 * пакетах, но для автора теста это одна операция.
 */
export {
  diffOperations,
  formatCompatibility,
  serializeSnapshot,
  snapshotOperations,
} from '@nestlingjs/app';
export type {
  CompatibilityChange,
  CompatibilityReport,
  CompatibilityVerdict,
  OperationDescriptor,
  OperationSnapshot,
  SnapshotOperation,
} from '@nestlingjs/app';

/** Интерфейс вендор-конвертера: его принимает `checkTopologies` */
export type { SchemaDocConverter } from '@nestlingjs/app';
