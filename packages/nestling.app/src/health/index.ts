/**
 * Пробы ядра: DI-токены, типы отчёта, ключи секции и kernel-модуль.
 *
 * Реализация узла и DI-токен секции наружу не идут: реализации ядра
 * приватны, как у конфига, логгера и портов.
 */

export { healthConfigKeys } from './config.js';
export type {
  Health,
  HealthCheck,
  HealthCheckResult,
  HealthReport,
  HealthStatus,
  LivenessReport,
  ReadinessStatus,
} from './interface.js';
export {
  healthKernel,
  registerHealth,
  resourceHealthChecks,
} from './kernel.js';
export type { HealthKernelOptions } from './kernel.js';
export { Health$, HealthCheck$ } from './tokens.js';
