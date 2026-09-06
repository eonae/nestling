/**
 * Читалка — единственное место в ядре, которое трогает `process.env`.
 *
 * Приватный kernel-токен: из `index.ts` не экспортируется ни класс, ни
 * токен, поэтому инжектить её пользовательскому коду нечем.
 */

import type { Logger } from '../logger/interface.js';

import type { SectionDeclaration } from './declaration.js';
import type { SharedKeyReader } from './errors.js';
import { ConfigSharedKeyError, ConfigSourceError } from './errors.js';
import type { ConfigTarget } from './keys.js';
import { describeTarget, targetCovers } from './keys.js';
import { declaredKeys } from './registry.js';
import type { ConfigBinding, ConfigSource } from './source.js';

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
  readonly targets: readonly ConfigTarget[];
  readonly name: string;
}

/**
 * Разрешает ключи по привязкам; `process.env` читается последним, с
 * низшим приоритетом.
 *
 * Создаётся вне контейнера, на фазе 0: `init()` поднимает источники и
 * снимает снимок объявленных ключей, а в граф читалка входит уже готовым
 * значением. Фазе 1 остаётся чтение из снимка, поэтому сборка синхронна и
 * ввода-вывода не делает.
 */
export class ConfigReader {
  readonly #bindings: readonly ResolvedBinding[];
  readonly #reloadable = new Set<Reloadable>();

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
   * нет, — член семейства `Config(key)` под unbound-глобом — попадает сюда
   * первым чтением: состав таких членов известен только внутри `build()`,
   * а `get()` источника синхронен по контракту.
   */
  readonly #snapshot = new Map<string, unknown>();

  /**
   * Ключ → первый заявивший его читатель.
   *
   * Живёт на экземпляре читалки, то есть ровно одну сборку: проверка
   * согласованности `reloadable` обязана видеть только секции, реально
   * созданные при сборке, и не протекать в следующую сборку того же
   * процесса (несколько `assembleTest` в одном тестовом файле).
   */
  readonly #claims = new Map<string, SharedKeyReader>();

  /**
   * Живая ссылка на `process.env`, а не копия: единственный контакт ядра
   * с окружением, и тесту достаточно выставить переменную до фазы 0.
   */
  readonly #env = process.env;

  constructor(bindings: readonly ConfigBinding[] = []) {
    this.#bindings = bindings.map(([source, target], index) => ({
      source,
      targets: Array.isArray(target)
        ? (target as readonly ConfigTarget[])
        : [target as ConfigTarget],
      name: source.name ?? `source #${index + 1}`,
    }));
  }

  /**
   * Фаза 0: поднимает источники, снимает снимок объявленных ключей и
   * сверяет таргеты с реестром.
   *
   * `init()` каждого источника зовётся один раз, по порядку привязок.
   * Повторы при временно недоступном источнике — забота самого источника:
   * цену и уместность повтора знает он, ядру нечем отличить временный
   * отказ от постоянного.
   *
   * Наблюдение навешивается после инициализации: до неё источнику нечего
   * сообщать, а секции ещё не спроецированы.
   *
   * @throws {ConfigSourceError} Если `init()` источника отказал
   */
  async init(): Promise<void> {
    for (const binding of this.#bindings) {
      try {
        await binding.source.init?.();
      } catch (error) {
        throw new ConfigSourceError(binding.name, error);
      }
    }

    this.#warnAboutEmptyTargets();

    for (const key of declaredKeys()) {
      this.#snapshot.set(key, this.#lookup(key));
    }

    for (const binding of this.#bindings) {
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

  /** Источники в порядке приоритета, включая `process.env` (для ошибок) */
  get sources(): readonly string[] {
    return [...this.#bindings.map((binding) => binding.name), 'process.env'];
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
   * Закрывает источники — явным шагом фазы SHUTDOWN.
   *
   * Не хук `@OnDestroy`: читалка живёт время `run()`, а не время
   * контейнера. Проверка состава контейнер не разрушает, и источники после
   * неё остались бы открытыми.
   */
  async close(): Promise<void> {
    for (const binding of this.#bindings) {
      await binding.source.close?.();
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
   * первая, чей таргет покрывает ключ и чей источник вернул не-`undefined`.
   * Источник, чей таргет ключ не покрывает, не опрашивается вовсе.
   */
  #lookup(key: string): unknown {
    for (const binding of this.#bindings) {
      if (!binding.targets.some((target) => targetCovers(target, key))) {
        continue;
      }

      const value = binding.source.get(key);
      if (value !== undefined) {
        return value;
      }
    }

    return this.#env[key];
  }

  #hasWatchingSource(keys: readonly string[]): boolean {
    return this.#bindings.some(
      (binding) =>
        binding.source.watch !== undefined &&
        keys.some((key) =>
          binding.targets.some((target) => targetCovers(target, key)),
        ),
    );
  }

  /**
   * Опечатка в глобе молча не привязывает ничего — дешёвая контрмера
   * сверяет каждый таргет с реестром объявленных ключей.
   *
   * Именно предупреждение, а не ошибка: глоб легитимно может смотреть в
   * будущее, на unbound-ключи семейств.
   */
  #warnAboutEmptyTargets(): void {
    const keys = declaredKeys();

    for (const binding of this.#bindings) {
      for (const target of binding.targets) {
        if (keys.some((key) => targetCovers(target, key))) {
          continue;
        }

        this.warn(
          `binding of source '${binding.name}' targets ${describeTarget(target)}, which covers none of the declared config keys`,
        );
      }
    }
  }
}
