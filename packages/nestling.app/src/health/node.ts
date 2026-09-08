/**
 * Реализация узла проб.
 *
 * Приватна, как и остальные реализации ядра: наружу пакет отдаёт DI-токен
 * `Health$`, типы отчёта и ключи секции.
 */

import type { Fields, Logger } from '../logger/interface.js';
import type { AppPhase } from '../root/phase.js';

import type { HealthConfig } from './config.js';
import type {
  Health,
  HealthCheck,
  HealthCheckResult,
  HealthReport,
  HealthStatus,
  LivenessReport,
} from './interface.js';

/** Вклад вместе с именем, под которым он зарегистрирован */
export interface NamedHealthCheck {
  /** Параметр члена `HealthCheck$` — имя проверки в отчёте */
  readonly name: string;

  /** Сам вклад */
  readonly check: HealthCheck;
}

/** Чем кончился вызов вклада: своим ответом или брошенной ошибкой */
type Outcome = { status: HealthStatus } | { error: unknown };

/** Прогон проверок с моментом времени: единица кэша */
interface CachedRun {
  /** Момент, когда прогон закончился */
  readonly at: number;

  /** Исходы прогона */
  readonly results: readonly HealthCheckResult[];
}

/** Ответ liveness один и тот же на все вызовы: он не зависит ни от чего */
const ALIVE: LivenessReport = Object.freeze({ status: 'ok' });

/**
 * Ждёт срабатывания сигнала. Промис не отвергается: гонку выигрывает
 * значение, а не исключение.
 */
const aborted = (signal: AbortSignal): Promise<'timeout'> =>
  new Promise((resolve) => {
    if (signal.aborted) {
      resolve('timeout');
      return;
    }

    signal.addEventListener('abort', () => resolve('timeout'), { once: true });
  });

/**
 * Узел проб: живость процесса и готовность приложения.
 *
 * Фазу узел читает функцией, а не полем графа: значение текущей фазы
 * принадлежит рантайму приложения, а не его графу.
 */
export class HealthNode implements Health {
  readonly #checks: readonly NamedHealthCheck[];
  readonly #phase: () => AppPhase;
  readonly #config: HealthConfig;
  readonly #logger: Logger;

  /** Последний законченный прогон; пока свеж, повторный вызов берёт его */
  #cached?: CachedRun;

  /** Незаконченный прогон: пришедшие во время него получают его результат */
  #running?: Promise<readonly HealthCheckResult[]>;

  constructor(
    checks: readonly NamedHealthCheck[],
    phase: () => AppPhase,
    config: HealthConfig,
    logger: Logger,
  ) {
    this.#checks = checks;
    this.#phase = phase;
    this.#config = config;
    this.#logger = logger;
  }

  liveness(): LivenessReport {
    return ALIVE;
  }

  async readiness(signal?: AbortSignal): Promise<HealthReport> {
    const phase = this.#phase();

    // До RUN и на SHUTDOWN состояние зависимостей ни на что не влияет:
    // трафик приложению не идёт в любом случае, а лишний прогон на дренаже
    // только удлинил бы остановку
    if (phase !== 'RUN') {
      return { status: 'not_ready', phase, checks: [] };
    }

    const checks = await this.#run(signal);
    const failed = checks.some(
      (result) => result.critical && result.status === 'down',
    );

    return { status: failed ? 'not_ready' : 'ready', phase, checks };
  }

  /**
   * Отдаёт исходы: из кэша, из текущего прогона или из нового.
   *
   * Кэшируются именно исходы, а не итог: фаза меняется без участия
   * проверок, поэтому итог считается заново на каждый вызов.
   */
  async #run(signal?: AbortSignal): Promise<readonly HealthCheckResult[]> {
    const cached = this.#cached;

    if (
      cached &&
      this.#config.cache > 0 &&
      Date.now() - cached.at < this.#config.cache
    ) {
      return cached.results;
    }

    // Пробы, пришедшие во время прогона, получают его результат: две пробы
    // подряд не должны превращаться в два запроса к базе
    if (this.#running) {
      return await this.#running;
    }

    const running = this.#runAll(signal);
    this.#running = running;

    try {
      const results = await running;
      this.#cached = { at: Date.now(), results };

      return results;
    } finally {
      this.#running = undefined;
    }
  }

  /** Прогоняет все проверки параллельно: медленная не задерживает быстрых */
  async #runAll(signal?: AbortSignal): Promise<readonly HealthCheckResult[]> {
    return await Promise.all(
      this.#checks.map(async (entry) => await this.#runOne(entry, signal)),
    );
  }

  /**
   * Прогоняет одну проверку со своим таймаутом.
   *
   * Таймаут гонится с самой проверкой, а не только взводит сигнал: вклад,
   * который сигнал игнорирует, иначе задержал бы весь отчёт.
   */
  async #runOne(
    { name, check }: NamedHealthCheck,
    signal?: AbortSignal,
  ): Promise<HealthCheckResult> {
    const { critical } = check;
    const started = Date.now();

    const timeout = AbortSignal.timeout(this.#config.timeout);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

    const outcome = await Promise.race([
      check.check(combined).then(
        (status): Outcome => ({ status }),
        (error: unknown): Outcome => ({ error }),
      ),
      aborted(timeout),
    ]);

    const durationMs = Date.now() - started;

    if (outcome === 'timeout') {
      this.#announce(name, critical, { reason: 'timeout' });

      return { name, critical, status: 'down', durationMs, reason: 'timeout' };
    }

    if ('error' in outcome) {
      this.#announce(name, critical, { reason: 'error', err: outcome.error });

      return { name, critical, status: 'down', durationMs, reason: 'error' };
    }

    if (outcome.status === 'down') {
      this.#announce(name, critical, {});
    }

    return { name, critical, status: outcome.status, durationMs };
  }

  /**
   * Пишет провал в логгер ядра: уровень задаёт критичность.
   *
   * Оригинал ошибки живёт только здесь. В отчёт он не попадает: тело пробы
   * читает балансировщик и любой, кто дотянулся до порта.
   */
  #announce(check: string, critical: boolean, fields: Fields): void {
    const record = { check, ...fields };

    if (critical) {
      this.#logger.error('health check is down', record);
    } else {
      this.#logger.warn('health check is down', record);
    }
  }
}
