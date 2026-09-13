/**
 * Читалка — разрешает ключи по привязкам `bind()`.
 *
 * Приватный DI-токен ядра: из `index.ts` не экспортируется ни класс, ни
 * DI-токен, поэтому инжектить её пользовательскому коду нечем.
 */

import type { SectionDeclaration } from './declaration.js';
import type { SharedKeyReader } from './errors.js';
import { ConfigSharedKeyError, ConfigSourceError } from './errors.js';
import type { ConfigTarget } from './keys.js';
import { describeTarget, targetCovers } from './keys.js';
import { declaredKeys } from './registry.js';
import type { Binding, ConfigSource } from './source.js';

import type { Logger } from '@nestlingjs/logging';

/**
 * Что читалка должна перепроецировать по сигналу источника.
 *
 * Интерфейс, а не импорт проекции: иначе `reader → project → reader` дал бы
 * цикл модулей.
 */
export interface Reloadable {
  /** Перечитать ключи и, если валидно, заменить снапшот */
  refresh(): void;
  /** Ключи секции — нужны для проверки «есть ли источник с наблюдением» */
  readonly keys: readonly string[];
}

/** Привязка в разобранном виде */
interface ResolvedBinding {
  readonly source: ConfigSource;
  readonly keys: ConfigTarget;
  readonly optional: boolean;
  readonly timeout: number;
  readonly name: string;
}

/**
 * Разрешает ключи по привязкам `bind()`.
 *
 * Создаётся вне контейнера, на фазе 0: `init()` поднимает источники и
 * снимает снимок объявленных ключей, а в граф читалка входит уже готовым
 * значением. Фазе 1 остаётся чтение из снимка, поэтому сборка синхронна и
 * ввода-вывода не делает.
 */
export class ConfigReader {
  readonly #bindings: readonly ResolvedBinding[];
  readonly #reloadable = new Set<Reloadable>();

  /** Привязки, чей `init()` отказал или истёк, но были `optional` */
  readonly #skipped = new Set<ResolvedBinding>();

  /**
   * Предупреждения, накопленные до подключения логгера.
   *
   * Логгер — узел графа, а читалка создаётся раньше него и не может от
   * него зависеть: реализация логгера читает секцию конфига. Поэтому до
   * `attachLogger` предупреждения копятся, а после — идут напрямую.
   */
  readonly #pending: string[] = [];

  #logger?: Logger;

  /**
   * Снимок фазы 0: ключ → его значение.
   *
   * Значения объявленных ключей кладёт `init()`. Ключ, которого в реестре
   * нет, — токен семейства `Config(key)` под unbound-глобом — попадает сюда
   * первым чтением: состав таких токенов семейства известен только внутри `build()`,
   * а `get()` источника синхронен по контракту.
   */
  readonly #snapshot = new Map<string, unknown>();

  /**
   * Ключ → первый заявивший его читатель.
   *
   * Живёт на экземпляре читалки, то есть ровно одну сборку: проверка
   * согласованности `reloadable` обязана видеть только секции, реально
   * созданные при сборке, и не протекать в следующую сборку того же
   * процесса (несколько `buildTest` в одном тестовом файле).
   */
  readonly #claims = new Map<string, SharedKeyReader>();

  constructor(bindings: readonly Binding[] = []) {
    this.#bindings = bindings.map((binding, index) => ({
      source: binding.source,
      keys: binding.keys,
      optional: binding.optional,
      timeout: binding.timeout,
      name: binding.source.name ?? `source #${index + 1}`,
    }));
  }

  /**
   * Фаза 0: поднимает источники, снимает снимок объявленных ключей и
   * сверяет области с реестром.
   *
   * `init()` каждого источника зовётся один раз, по порядку привязок, с
   * границей `timeout`. Привязка с `optional: true`, чей `init()` отказал
   * или не уложился в границу, пропускается — фаза 0 продолжается без
   * этого источника вместо отказа. Повторы при временно недоступном
   * источнике — забота самого источника: цену и уместность повтора знает
   * он, ядру нечем отличить временный отказ от постоянного.
   *
   * Наблюдение навешивается после инициализации: до неё источнику нечего
   * сообщать, а секции ещё не спроецированы.
   *
   * @throws {ConfigSourceError} Если `init()` источника отказал или не
   * уложился в `timeout`, а привязка не `optional`
   */
  async init(): Promise<void> {
    for (const binding of this.#bindings) {
      try {
        await this.#initOne(binding);
      } catch (error) {
        if (binding.optional) {
          this.#skipped.add(binding);
          continue;
        }

        throw new ConfigSourceError(binding.name, error);
      }
    }

    this.#warnAboutEmptyTargets();

    for (const key of declaredKeys()) {
      this.#snapshot.set(key, this.#lookup(key));
    }

    for (const binding of this.#active()) {
      binding.source.watch?.(() => {
        this.#refreshAll();
      });
    }
  }

  /**
   * Значение ключа из снимка фазы 0 или `undefined`.
   *
   * Ключ вне снимка — тот, которого не называет ни одна объявленная
   * секция, — читается на месте и запоминается: ввода-вывода это не
   * делает, `get()` источника синхронен по контракту.
   */
  read(key: string): unknown {
    if (this.#snapshot.has(key)) {
      return this.#snapshot.get(key);
    }

    const value = this.#lookup(key);
    this.#snapshot.set(key, value);

    return value;
  }

  /**
   * Заявляет ключи секции, которая создаётся при сборке, и сверяет их с
   * уже заявленными.
   *
   * Право читать ключ не означает владения им: второй читатель объявляется
   * без ведома первого, схемы читателей независимы. Расходиться нельзя ровно
   * в одном — во флаге `reloadable`, потому что это свойство ключа, а не
   * объявления.
   *
   * @throws {ConfigSharedKeyError} Если флаг разошёлся с первым читателем
   */
  claimKeys(declaration: SectionDeclaration): void {
    for (const field of declaration.fields) {
      const claimed = this.#claims.get(field.key);

      if (!claimed) {
        this.#claims.set(field.key, {
          section: declaration.prefix,
          field: field.name,
          reloadable: declaration.reloadable,
        });

        continue;
      }

      if (claimed.reloadable !== declaration.reloadable) {
        throw new ConfigSharedKeyError(field.key, [
          claimed,
          {
            section: declaration.prefix,
            field: field.name,
            reloadable: declaration.reloadable,
          },
        ]);
      }
    }
  }

  /** Источники в порядке приоритета, реально поднявшиеся на фазе 0 */
  get sources(): readonly string[] {
    return this.#active().map((binding) => binding.name);
  }

  /**
   * Предупреждение: в логгер, если он подключён, иначе в буфер до
   * подключения.
   */
  warn(message: string): void {
    if (this.#logger) {
      this.#logger.warn(message);
    } else {
      this.#pending.push(message);
    }
  }

  /**
   * Подключает логгер: отдаёт накопленные предупреждения и переключает
   * `warn` на прямую запись.
   *
   * Сборка приложения вызывает его сразу после `build()` с
   * `Logger$('nestling:config')`. Повторный вызов заменяет логгер.
   */
  attachLogger(logger: Logger): void {
    this.#logger = logger;

    for (const message of this.#pending.splice(0)) {
      logger.warn(message);
    }
  }

  /**
   * Ставит секцию на перепроекцию и предупреждает, если её ключи не покрыты
   * ни одним источником с наблюдением.
   *
   * Несовпадение способностей — не нарушение операции: reloadable-секция
   * на голом env поднимается, просто обновлений не будет.
   */
  registerReloadable(section: Reloadable): void {
    this.#reloadable.add(section);

    if (!this.#hasWatchingSource(section.keys)) {
      this.warn(
        `reloadable config section is bound to no source that supports watch, so its values will never change: keys ${section.keys.join(', ')}`,
      );
    }
  }

  /**
   * Закрывает источники, поднявшиеся на фазе 0 — явным шагом фазы SHUTDOWN.
   *
   * Не узел графа: читалка живёт время `run()`, а не время
   * контейнера. Проверка состава контейнер не разрушает, и источники после
   * неё остались бы открытыми.
   */
  async close(): Promise<void> {
    for (const binding of this.#active()) {
      await binding.source.close?.();
    }
  }

  /** Привязки, чей источник реально поднялся на фазе 0 */
  #active(): readonly ResolvedBinding[] {
    return this.#bindings.filter((binding) => !this.#skipped.has(binding));
  }

  /**
   * Вызывает `init()` источника с границей `timeout` этой привязки.
   *
   * `Promise.race` с таймером: источник без `init()` разрешается сразу.
   */
  async #initOne(binding: ResolvedBinding): Promise<void> {
    if (!binding.source.init) {
      return;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;

    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(
          new Error(
            `initialization did not complete within ${binding.timeout}ms`,
          ),
        );
      }, binding.timeout);
      timer.unref?.();
    });

    try {
      await Promise.race([Promise.resolve(binding.source.init()), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Перечитывает ключи reloadable-секций в снимок и перепроецирует их.
   *
   * Снимок обновляется до перепроекции: иначе секция считалась бы из
   * старых значений, а семейство `Config(key)` отдавало бы третьи.
   */
  #refreshAll(): void {
    for (const section of this.#reloadable) {
      for (const key of section.keys) {
        this.#snapshot.set(key, this.#lookup(key));
      }
    }

    for (const section of this.#reloadable) {
      section.refresh();
    }
  }

  /**
   * Спрашивает значение у источников, минуя снимок.
   *
   * Привязки просматриваются по порядку (порядок = приоритет): выигрывает
   * первая, чья область покрывает ключ и чей источник вернул не-`undefined`.
   * Источник, чья область ключ не покрывает, не опрашивается вовсе.
   */
  #lookup(key: string): unknown {
    for (const binding of this.#active()) {
      if (!targetCovers(binding.keys, key)) {
        continue;
      }

      const value = binding.source.get(key);
      if (value !== undefined) {
        return value;
      }
    }

    return undefined;
  }

  #hasWatchingSource(keys: readonly string[]): boolean {
    return this.#active().some(
      (binding) =>
        binding.source.watch !== undefined &&
        keys.some((key) => targetCovers(binding.keys, key)),
    );
  }

  /**
   * Опечатка в глобе молча не привязывает ничего — дешёвая контрмера
   * сверяет каждую область с реестром объявленных ключей.
   *
   * Именно предупреждение, а не ошибка: глоб легитимно может смотреть в
   * будущее, на unbound-ключи семейств.
   */
  #warnAboutEmptyTargets(): void {
    const keys = declaredKeys();

    for (const binding of this.#active()) {
      if (keys.some((key) => targetCovers(binding.keys, key))) {
        continue;
      }

      this.warn(
        `binding of source '${binding.name}' targets ${describeTarget(binding.keys)}, which covers none of the declared config keys`,
      );
    }
  }
}
