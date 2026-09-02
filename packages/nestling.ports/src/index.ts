/**
 * `@nestling/ports` — операции, порты и in-proc шина.
 *
 * Сторона ядра (реестр операций, держатель исполнителей, вызыватели и
 * их семейства) наружу не экспортируется: граница держится видимостью
 * ES-модулей, а не рантайм-проверкой. Публично — объявление операции,
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
  diffOperations,
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
export { canonicalizeJson, describeOperation } from './describe.js';
export type {
  OperationDescriptor,
  DescribeOptions,
  DescribeSource,
  FailDescriptor,
  FileFieldDescriptor,
  FormDescriptorValue,
  JsonValue,
  SchemaDescriptor,
} from './describe.js';
/**
 * Типы вызывателей реэкспортируются, а `makeRequest` и типы операции —
 * **нет**.
 *
 * Разница не в аккуратности, а в направлении: `Port`/`Emitter` разбирает
 * потребитель порта, у которого сервер уже под рукой, — импортировать их из
 * того же пакета, что `implement`, ему естественно. А реэкспорт
 * `makeRequest` вернул бы объявление операции в пакет с серверными
 * зависимостями и снова сделал бы «операция импортируется во фронт»
 * вопросом дисциплины импортов. Канонический импорт — `@nestling/operations`.
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
} from '@nestling/operations';
export { implement } from './implement.js';
export type { ImplementDictionary } from './implement.js';
export { bindPorts, portsKernel, undurableOperations } from './kernel.js';
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
  snapshotOperations,
} from './snapshot.js';
export type {
  OperationReport,
  OperationSnapshot,
  SnapshotOperation,
  SnapshotSource,
  TopologyOperationReport,
} from './snapshot.js';
export { collectImplementations } from './topology.js';
export type {
  ContractImplementation,
  OperationTopology,
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
