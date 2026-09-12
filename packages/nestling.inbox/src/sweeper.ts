/**
 * Уборщик отметок: фоновая задача, которая удаляет устаревшие отметки.
 *
 * Уборщик — ресурс, а не компонент. Фаза SHUTDOWN взводит сигнал
 * `@OnStart`, а затем освобождает ресурсы в обратном топологическом
 * порядке, и завершения фоновой задачи компонента при этом никто не ждёт.
 * Уборщик же обязан дочистить партию до того, как закроется хранилище:
 * `release()` дожидается конца текущего прохода, а зависимость от
 * хранилища ставит уборщик раньше него в порядке освобождения.
 */

import type { InboxConfigValues } from './config.js';
import type { InboxStore } from './types.js';

import type { Logger } from '@nestlingjs/app';
import { makeToken, OnStart } from '@nestlingjs/container';

/** DI-токен уборщика: тест берёт по нему `sweepOnce()`, приложение — ничего */
export const InboxSweeper$ = makeToken<InboxSweeper>(
  '@nestlingjs/inbox:sweeper',
);

/** Всё, что нужно уборщику для работы; собирает провайдер плагина */
export interface InboxSweeperOptions {
  readonly store: InboxStore;
  readonly config: InboxConfigValues;
  readonly logger: Logger;
}

/** Текст отказа для записи в логгер */
const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Уборщик отметок приёма.
 *
 * Цикл разложен на два уровня: {@link sweepOnce} выполняет один проход, а
 * `@OnStart` повторяет его до сигнала. Так тест детерминирован: тестовая
 * сборка останавливается после фазы WIRE и `@OnStart` не выполняет,
 * поэтому проход вызывается вручную и таймера ждать не нужно.
 *
 * @example
 * ```typescript
 * const sweeper = app.get(InboxSweeper$);
 * const removed = await sweeper.sweepOnce();
 * ```
 */
export class InboxSweeper {
  /** Конструирует уборщик; зависимости собирает провайдер плагина */
  static async acquire(options: InboxSweeperOptions): Promise<InboxSweeper> {
    return new InboxSweeper(options);
  }

  readonly #options: InboxSweeperOptions;

  /** Цикл, запущенный `@OnStart`; `undefined`, пока он не запущен */
  #loop?: Promise<void>;

  /** Взводится `release()`: цикл заканчивается на границе прохода */
  #stopped = false;

  /** Прерывает паузу между проходами */
  #wake?: () => void;

  private constructor(options: InboxSweeperOptions) {
    this.#options = options;
  }

  /** Чистит ли таблицу этот процесс; решает поле `sweep` секции конфига */
  get enabled(): boolean {
    return this.#options.config.sweep;
  }

  /**
   * Запускает цикл. Хук возвращает управление сразу: фаза START ждёт
   * каждый `@OnStart`, и цикл, выполненный внутри хука, не дал бы
   * приложению стартовать.
   *
   * @param signal - Сигнал остановки приложения
   */
  @OnStart()
  run(signal: AbortSignal): void {
    if (!this.enabled || this.#loop) {
      return;
    }

    this.#loop = this.#poll(signal);
  }

  /**
   * Один проход: удаление отметок старше срока хранения.
   *
   * Публичный, потому что тест вызывает его сам. Цикла внутри нет.
   *
   * @returns Сколько отметок удалено
   */
  async sweepOnce(): Promise<number> {
    const { retentionMs, batchSize } = this.#options.config;

    return this.#options.store.sweep({
      olderThan: Date.now() - retentionMs,
      limit: batchSize,
    });
  }

  /**
   * Останавливает уборщик и дожидается конца текущего прохода.
   *
   * Зовёт его контейнер на SHUTDOWN. Порядок освобождения обратный
   * топологическому, а уборщик зависит от хранилища, поэтому хранилище
   * закрывается после него.
   */
  async release(): Promise<void> {
    this.#stopped = true;
    this.#wake?.();

    await this.#loop;
  }

  /** Цикл: проход за проходом, пока не взведён сигнал */
  async #poll(signal: AbortSignal): Promise<void> {
    while (!signal.aborted && !this.#stopped) {
      try {
        await this.sweepOnce();
      } catch (error) {
        // Отказ хранилища не должен убивать цикл: следующий проход
        // повторит уборку
        this.#options.logger.error('inbox sweep failed', {
          error: reasonOf(error),
        });
      }

      if (signal.aborted || this.#stopped) {
        return;
      }

      await this.#pause(signal);
    }
  }

  /** Пауза между проходами; прерывается сигналом и остановкой */
  async #pause(signal: AbortSignal): Promise<void> {
    const { sweepIntervalMs } = this.#options.config;

    await new Promise<void>((resolve) => {
      const finish = (): void => {
        clearTimeout(timer);
        signal.removeEventListener('abort', finish);
        this.#wake = undefined;
        resolve();
      };

      const timer = setTimeout(finish, sweepIntervalMs);

      this.#wake = finish;
      signal.addEventListener('abort', finish, { once: true });
    });
  }
}
