/**
 * Интерфейсы проб: вклад, исход, отчёт и сам узел.
 *
 * Ядро отдаёт состояние **значением**: `Health$` возвращает отчёт, а
 * форматом занимается тот, кто пробу обслуживает — HTTP-плагин, CLI или
 * satellite-пакет метрик.
 */

import type { AppPhase } from '../root/phase.js';

/**
 * Исход одной проверки.
 *
 * - `ok` — зависимость отвечает;
 * - `degraded` — отвечает частично: вклад сам решил, что работает не
 *   полностью, и на итог readiness это не влияет;
 * - `down` — не отвечает.
 */
export type HealthStatus = 'ok' | 'degraded' | 'down';

/** Итог readiness: принимать трафик или нет */
export type ReadinessStatus = 'ready' | 'not_ready';

/**
 * Вклад в пробы: одна проверка одной зависимости.
 *
 * Регистрируется обычным провайдером члена семейства `HealthCheck$`.
 * Имя проверки задаёт член (`HealthCheck$('db')`), поэтому в самом вкладе
 * его нет: два разных имени у одного вклада разошлись бы.
 *
 * @example
 * ```typescript
 * @Component([Database$])
 * export class DbHealthCheck implements HealthCheck {
 *   readonly critical = true;
 *
 *   constructor(private readonly db: Database) {}
 *
 *   async check(signal: AbortSignal): Promise<HealthStatus> {
 *     await this.db.query('SELECT 1', { signal });
 *     return 'ok';
 *   }
 * }
 *
 * // в providers: модуля
 * classProvider(HealthCheck$('db'), DbHealthCheck);
 * ```
 */
export interface HealthCheck {
  /**
   * Провал этой проверки делает приложение неготовым.
   *
   * Некритичная проверка попадает в отчёт, но итога не меняет: кэш,
   * который отвалился, — повод посмотреть в лог, а не увести под из-под
   * приложения трафик.
   */
  readonly critical: boolean;

  /**
   * Выполняет проверку. Сигнал складывает отмену запроса и таймаут
   * проверки: вклад обязан передать его дальше, в вызов зависимости.
   */
  check(signal: AbortSignal): Promise<HealthStatus>;
}

/**
 * Исход одной проверки в отчёте.
 *
 * Сообщения ошибки и стека здесь нет: тело пробы читает балансировщик и
 * любой, кто дотянулся до порта. Оригинал уходит в
 * `Logger$('nestling:health')`.
 */
export interface HealthCheckResult {
  /** Имя проверки — параметр члена `HealthCheck$` */
  readonly name: string;

  /** Признак критичности, объявленный вкладом */
  readonly critical: boolean;

  /** Исход */
  readonly status: HealthStatus;

  /** Сколько заняла проверка, мс */
  readonly durationMs: number;

  /** Чем кончилась проверка, если не своим ответом: без сообщения и стека */
  readonly reason?: 'timeout' | 'error';
}

/** Ответ liveness: процесс отвечает, и это единственное, что он значит */
export interface LivenessReport {
  readonly status: 'ok';
}

/**
 * Отчёт readiness: итог, фаза и исходы проверок.
 *
 * Итог `ready` — фаза RUN и ни одной критичной проверки со статусом
 * `down`. До RUN и на SHUTDOWN проверки не запускаются вовсе, поэтому
 * список исходов пуст.
 */
export interface HealthReport {
  /** Принимать трафик или нет */
  readonly status: ReadinessStatus;

  /** Фаза, в которой отчёт собран */
  readonly phase: AppPhase;

  /** Исходы проверок в порядке регистрации вкладов */
  readonly checks: readonly HealthCheckResult[];
}

/**
 * Узел проб: живость процесса и готовность приложения.
 *
 * Регистрируется всегда, полей в `makeApp` не требует.
 * `container.getOrThrow(Health$)` после фазы INIT возвращает его у любого
 * приложения.
 */
export interface Health {
  /**
   * Отвечает `ok` всегда и проверок не запускает: ответ и есть признак
   * жизни процесса. Вставший event loop не ответит в любом случае.
   */
  liveness(): LivenessReport;

  /**
   * Собирает отчёт о готовности.
   *
   * @param signal - Сигнал вызова; его отмена прекращает прогон
   */
  readiness(signal?: AbortSignal): Promise<HealthReport>;
}
