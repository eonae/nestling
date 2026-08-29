/**
 * `@nestling/testing` — тестовый composition root.
 *
 * Пакет тонкий по построению: тестируемость здесь следствие архитектуры,
 * а не механизма пакета. Раннера, матчеров и snapshot-механики он не
 * вводит — jest остаётся jest'ом.
 *
 * Строковой формы доступа к токену (`overrideByName('…')`) в экспорте нет
 * и не будет: это дыра в ES-видимости и обесценивание kernel/user-границы.
 */

export { assembleTest, TestApp } from './app.js';
export type {
  EmitDelivery,
  TestAssemblySpec,
  TestCallOptions,
  TestStub,
} from './app.js';
export { vars } from './config.js';
export type { TestConfig } from './config.js';
export { contextValue } from './context.js';
export { testModule } from './module.js';
export type { TestModuleOptions } from './module.js';
export { familyOverride } from './overrides.js';
export type { TestOverride } from './overrides.js';
export { stub } from './stub.js';
export type {
  ContractStub,
  EmitStubImpl,
  RequestStubImpl,
  StubOutput,
} from './stub.js';
export { checkTopologies } from './topologies.js';
export type { TopologyReport } from './topologies.js';
export { unwrap, UnwrapFailedError } from './unwrap.js';

/**
 * Отчёт `App.check()` и его опции — реэкспорт типов: матрица топологий
 * их принимает и возвращает, и тест не должен ради одной аннотации
 * импортировать `@nestling/app`.
 */
export type { CheckOptions, CheckReport } from '@nestling/app';

/**
 * Снапшот и дифф контрактов — реэкспорт из `@nestling/ports`.
 *
 * CI-тест матрицы («собери снапшот, сравни с baseline, напечатай отчёт»)
 * пишется одним импортом: топологии, сведение и сравнение живут в разных
 * пакетах, но для автора теста это одна операция.
 */
export {
  diffContracts,
  formatCompatibility,
  serializeSnapshot,
  snapshotContracts,
} from '@nestling/ports';
export type {
  CompatibilityChange,
  CompatibilityReport,
  CompatibilityVerdict,
  ContractDescriptor,
  ContractSnapshot,
  SnapshotContract,
} from '@nestling/ports';

/** Контракт вендор-конвертера: его принимает `checkTopologies` */
export type { SchemaDocConverter } from '@nestling/pipeline';
