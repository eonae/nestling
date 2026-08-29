/**
 * `@nestling/ports` — контракты, порты и in-proc шина.
 *
 * Сторона ядра (реестр контрактов, держатель исполнителей, вызыватели и
 * их семейства) наружу не экспортируется: граница держится видимостью
 * ES-модулей, а не рантайм-проверкой. Публично — объявление контракта,
 * его реализация, интерфейс шины и точки, которыми пользуется композиционный
 * корень.
 *
 * Отдельная группа экспортов — то, что нужно **автору реализации шины**:
 * биндинг декларации, пересчёт конверта профиля и сборка ответа границы.
 * Без них сторонний транспорт (`@nestling/transport.nats` и любой другой)
 * не смог бы вести себя так же, как in-proc шина, а «альтернативная
 * реализация пишется без правок ядра» осталась бы обещанием.
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
export {
  diffContracts,
  formatCompatibility,
  suggestBump,
} from './compatibility.js';
export type {
  CompatibilityChange,
  CompatibilityReport,
  CompatibilityVerdict,
  ContractCompatibility,
  ContractSlot,
} from './compatibility.js';
export { portsConfigKeys } from './config.js';
export type { DispatchPolicy, PortsConfig } from './config.js';
export { canonicalizeJson, describeContract } from './describe.js';
export type {
  ContractDescriptor,
  DescribeOptions,
  DescribeSource,
  FailDescriptor,
  FileFieldDescriptor,
  FormDescriptorValue,
  JsonValue,
  SchemaDescriptor,
} from './describe.js';
/**
 * Типы вызывателей реэкспортируются, а `makeContract` и типы контракта —
 * **нет**.
 *
 * Разница не в аккуратности, а в направлении: `Port`/`Emitter` разбирает
 * потребитель порта, у которого сервер уже под рукой, — импортировать их из
 * того же пакета, что `implement`, ему естественно. А реэкспорт
 * `makeContract` вернул бы объявление контракта в пакет с серверными
 * зависимостями и снова сделал бы «контракт импортируется во фронт»
 * вопросом дисциплины импортов. Канонический импорт — `@nestling/contracts`.
 */
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
} from '@nestling/contracts';
export { implement } from './implement.js';
export type { ImplementDictionary } from './implement.js';
export { bindPorts, portsKernel, undurableContracts } from './kernel.js';
export type { PortsKernelOptions } from './kernel.js';
export {
  Deadline,
  deadlineFromTimeout,
  deadlineIn,
  IdempotencyKey,
  isExhausted,
  profileAttributes,
  startBudget,
  withDeadline,
  withIdempotencyKey,
} from './profile.js';
export type { CallBudget } from './profile.js';
export { failureResponse } from './response.js';
export type { PortFailureInfo } from './runtime.js';
export {
  serializeSnapshot,
  SNAPSHOT_VERSION,
  snapshotContracts,
} from './snapshot.js';
export type {
  ContractReport,
  ContractSnapshot,
  SnapshotContract,
  SnapshotSource,
  TopologyContractReport,
} from './snapshot.js';
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
 * кодов ядра; здесь оно повторно экспортируется потому, что разбирает
 * результат `call` потребитель порта — и импортировать `DeadlineExceeded`
 * ему естественно из того же пакета, что и всё остальное.
 */
export { DeadlineExceeded } from '@nestling/pipeline';
