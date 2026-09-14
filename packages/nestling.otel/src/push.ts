/**
 * Плагин сателлита: отправка метрик по таймеру и сброс на остановке.
 *
 * Ресурс зависит от `MetricsStore$`, и эта зависимость задаёт порядок: в
 * реверсе освобождения сателлит закрывается раньше store, поэтому снимок
 * на остановке ему ещё доступен.
 *
 * Своих инструментов сателлит не заводит: агрегат уже посчитан store, и
 * второй агрегатор дал бы две несовпадающие правды об одном ряде.
 */

import { now } from './clock.js';
import type { OtelOptions } from './options.js';
import { DEFAULT_INTERVAL_MS, SCOPE_NAME } from './options.js';
import { pointsOf } from './points.js';

import type { Logger, MetricsStore, Plugin } from '@nestlingjs/app';
import { Logger$, makePlugin, MetricsStore$ } from '@nestlingjs/app';
import { Resource } from '@nestlingjs/container';
import type { HrTime } from '@opentelemetry/api';
import type { Resource as TelemetryResource } from '@opentelemetry/resources';

/**
 * Код успеха в результате отправки — `ExportResultCode.SUCCESS`.
 *
 * Значение записано числом, потому что перечисление живёт в
 * `@opentelemetry/core`: границу пакета задают пять пакетов
 * OpenTelemetry, и шестой ради одной константы в них не входит.
 */
const EXPORT_SUCCESS = 0;

/**
 * Собирает плагин отправки метрик.
 *
 * @param options - Опции сателлита
 * @param target - Атрибуты ресурса сателлита
 * @returns Плагин с ресурсом отправки
 */
export function makePush(
  options: OtelOptions,
  target: TelemetryResource,
): Plugin {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;

  /**
   * Отправка метрик: таймер поверх снимка store.
   *
   * Без опции `metrics` ресурс таймера не заводит и store не читает —
   * остаётся только закрытие экспортёра участков на остановке.
   */
  @Resource([MetricsStore$, Logger$.auto])
  class OtelExport {
    /**
     * Заводит таймер отправки.
     *
     * @param store - Накопленные метрики приложения
     * @param logger - Логгер сателлита
     * @param _signal - Сигнал остановки старта; отправке он не нужен
     * @returns Ресурс, снимающий таймер на остановке
     */
    static async acquire(
      store: MetricsStore,
      logger: Logger,
      _signal: AbortSignal,
    ): Promise<OtelExport> {
      return new OtelExport(store, logger);
    }

    /** Начало накопления: точки кумулятивные, и отсчёт идёт отсюда */
    readonly #started: HrTime = now();

    /** Таймер отправки; без опции `metrics` его нет */
    readonly #timer: ReturnType<typeof setInterval> | undefined;

    /** Очередь отправок: снятие следующего снимка ждёт предыдущей */
    #sending: Promise<void> = Promise.resolve();

    /**
     * @param store - Накопленные метрики приложения
     * @param logger - Логгер сателлита
     */
    private constructor(
      private readonly store: MetricsStore,
      private readonly logger: Logger,
    ) {
      if (options.metrics === undefined) {
        return;
      }

      this.#timer = setInterval(() => this.#enqueue(), intervalMs);

      // Таймер не держит процесс: отправка метрик — не повод откладывать
      // остановку, а последний снимок уходит из `release`
      this.#timer.unref();
    }

    /**
     * Снимает таймер, отправляет последний снимок и закрывает экспортёров.
     *
     * Записи последнего интервала не теряются: снимок на остановке ещё
     * доступен, потому что store освобождается позже сателлита.
     */
    async release(): Promise<void> {
      if (this.#timer !== undefined) {
        clearInterval(this.#timer);
      }

      this.#enqueue();
      await this.#sending;

      await Promise.all([
        this.#close(options.metrics),
        this.#close(options.traces),
      ]);
    }

    /** Закрывает экспортёра; его отказ уходит в логгер и остановку не срывает */
    async #close(exporter?: { shutdown(): Promise<void> }): Promise<void> {
      try {
        await exporter?.shutdown();
      } catch (error) {
        this.logger.warn(error as Error);
      }
    }

    /** Ставит отправку в очередь: две отправки не идут одновременно */
    #enqueue(): void {
      this.#sending = this.#sending.then(async () => this.#send());
    }

    /** Отправляет снимок; отказ уходит в логгер и наружу не всплывает */
    async #send(): Promise<void> {
      const exporter = options.metrics;

      if (exporter === undefined) {
        return;
      }

      try {
        const points = pointsOf(
          this.store.snapshot(),
          target,
          this.#started,
          now(),
        );

        await new Promise<void>((resolve) => {
          exporter.export(points, ({ code, error }) => {
            if (code !== EXPORT_SUCCESS) {
              this.logger.warn(
                error ?? new Error('OTLP metrics export failed'),
              );
            }

            resolve();
          });
        });
      } catch (error) {
        // Брошенная экспортёром ошибка не должна ни ронять таймер, ни
        // срывать остановку: очередь отправок живёт до конца процесса
        this.logger.warn(error as Error);
      }
    }
  }

  return makePlugin({ name: SCOPE_NAME, providers: [OtelExport] });
}
