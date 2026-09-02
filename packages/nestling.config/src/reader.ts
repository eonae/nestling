/**
 * Читалка — единственное место в ядре, которое трогает `process.env`.
 *
 * Приватный kernel-токен: из `index.ts` не экспортируется ни класс, ни
 * токен, поэтому инжектить её пользовательскому коду нечем.
 */

import type { SectionDeclaration } from './declaration.js';
import type { SharedKeyReader } from './errors.js';
import { ConfigSharedKeyError } from './errors.js';
import type { ConfigTarget } from './keys.js';
import { describeTarget, targetCovers } from './keys.js';
import { declaredKeys } from './registry.js';
import type { ConfigBinding, ConfigSource } from './source.js';

import { OnDestroy } from '@nestling/container';

/** Канал предупреждений — подменяемый, чтобы тест их перехватывал */
export type ConfigWarn = (message: string) => void;

/** Опции читалки */
export interface ConfigReaderOptions {
  /** По умолчанию — `console.warn` с префиксом `[nestling/config]` */
  onWarn?: ConfigWarn;
}

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

const defaultWarn: ConfigWarn = (message) => {
  // eslint-disable-next-line no-console
  console.warn(`[nestling/config] ${message}`);
};

/**
 * Разрешает ключи по привязкам; `process.env` читается последним, с
 * низшим приоритетом.
 *
 * Узел графа с асинхронной фабрикой: порядок инстанцирования гарантирует,
 * что `init()` всех источников отработал до проекции любой секции — это
 * топология, а не отдельная фаза.
 */
export class ConfigReader {
  readonly #bindings: readonly ResolvedBinding[];
  readonly #warn: ConfigWarn;
  readonly #reloadable = new Set<Reloadable>();

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
   * Живая ссылка на `process.env`, а не снимок: единственный контакт ядра
   * с окружением, и тесту достаточно выставить переменную до сборки.
   */
  readonly #env = process.env;

  constructor(
    bindings: readonly ConfigBinding[] = [],
    options: ConfigReaderOptions = {},
  ) {
    this.#warn = options.onWarn ?? defaultWarn;
    this.#bindings = bindings.map(([source, target], index) => ({
      source,
      targets: Array.isArray(target)
        ? (target as readonly ConfigTarget[])
        : [target as ConfigTarget],
      name: source.name ?? `source #${index + 1}`,
    }));
  }

  /**
   * Поднимает источники и сверяет таргеты с реестром объявленных ключей.
   *
   * Наблюдение навешивается после инициализации: до неё источнику нечего
   * сообщать, а секции ещё не спроецированы.
   */
  async init(): Promise<void> {
    for (const binding of this.#bindings) {
      await binding.source.init?.();
    }

    this.#warnAboutEmptyTargets();

    for (const binding of this.#bindings) {
      binding.source.watch?.(() => {
        this.#refreshAll();
      });
    }
  }

  /**
   * Значение ключа или `undefined`.
   *
   * Привязки просматриваются по порядку (порядок = приоритет): выигрывает
   * первая, чей таргет покрывает ключ и чей источник вернул не-`undefined`.
   * Источник, чей таргет ключ не покрывает, не опрашивается вовсе.
   */
  read(key: string): unknown {
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

  /** Предупреждение через подменяемый канал */
  warn(message: string): void {
    this.#warn(message);
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
      this.#warn(
        `reloadable config section is bound to no source that supports watch, so its values will never change: keys ${section.keys.join(', ')}`,
      );
    }
  }

  /** Закрывает источники в общем shutdown контейнера */
  @OnDestroy()
  async close(): Promise<void> {
    for (const binding of this.#bindings) {
      await binding.source.close?.();
    }
  }

  #refreshAll(): void {
    for (const section of this.#reloadable) {
      section.refresh();
    }
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

        this.#warn(
          `binding of source '${binding.name}' targets ${describeTarget(target)}, which covers none of the declared config keys`,
        );
      }
    }
  }
}
