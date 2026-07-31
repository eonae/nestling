/**
 * `@nestling/ports` — контракты, порты и in-proc шина.
 *
 * Kernel-сторона (реестр контрактов, держатель исполнителей, вызыватели и
 * их семейства) наружу не экспортируется: граница держится видимостью
 * ES-модулей, а не рантайм-проверкой. Публично — объявление контракта,
 * его реализация, интерфейс шины и точки, которыми пользуется композиционный
 * корень.
 */

export { InProcessBus, MessageBus$ } from './bus.js';
export type {
  BusHandler,
  BusMessageMeta,
  BusSubscription,
  IMessageBus,
  InProcessBusOptions,
  PublishOptions,
  RequestOptions,
  SubscribeOptions,
} from './bus.js';
export { portsConfigKeys } from './config.js';
export type { DispatchPolicy, PortsConfig } from './config.js';
export { makeContract } from './contract.js';
export type {
  AnyContract,
  CommandContract,
  Contract,
  ContractKind,
  ContractSpec,
  EmittingContract,
  EventContract,
  FailsOf,
  InputFormOf,
  InputOf,
  OutputFormOf,
  OutputOf,
  RequestContract,
} from './contract.js';
export type {
  CommandMeta,
  Emitter,
  EmitterToken,
  InvokeArgs,
  KernelPortFail,
  MetaOf,
  Port,
  PortMeta,
  PortResult,
  PortToken,
} from './families.js';
export { implement } from './implement.js';
export type { ImplementDictionary } from './implement.js';
export { bindPorts, portsKernel } from './kernel.js';
export type { PortsKernelOptions } from './kernel.js';
export {
  Deadline,
  deadlineIn,
  IdempotencyKey,
  withDeadline,
  withIdempotencyKey,
} from './profile.js';
export type { PortFailureInfo } from './runtime.js';
export { collectImplementations } from './topology.js';
export type {
  ContractImplementation,
  ContractTopology,
  ContractTopologyEntry,
  DiscoveredDeclaration,
} from './topology.js';
export {
  BUS_TRANSPORT_NAME,
  BusTransport$,
  busBindingOf,
} from './transport.js';
export type { BusBinding } from './transport.js';

/**
 * Реэкспорт определения отказа бюджета.
 *
 * Само определение живёт в `@nestling/pipeline`, где живёт закрытый набор
 * kernel-кодов; здесь оно повторно экспортируется потому, что разбирает
 * результат `call` потребитель порта — и импортировать `DeadlineExceeded`
 * ему естественно из того же пакета, что и всё остальное.
 */
export { DeadlineExceeded } from '@nestling/pipeline';
