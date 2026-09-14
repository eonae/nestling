/**
 * Читалка — разрешает ключи по привязкам `bind()`.
 *
 * Приватный DI-токен ядра: из `index.ts` не экспортируется ни класс, ни
 * DI-токен, поэтому инжектить её пользовательскому коду нечем.
 */

import type { SectionDeclaration } from './declaration.js';
import type { SharedKeyReader } from './errors.js';
import {
  ConfigNeedsDeclarationError,
  ConfigSharedKeyError,
  ConfigSourceCycleError,
  ConfigSourceError,
  ConfigSourceNeedsError,
} from './errors.js';
import type { ConfigTarget } from './keys.js';
import { describeTarget, targetCovers } from './keys.js';
import { declaredKeys, lookupSection } from './registry.js';
import type { Binding, ConfigSource } from './source.js';
import { presentValue } from './source.js';

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

/**
 * Проекция объявленной секции — её даёт фаза 0 аргументом конструктора.
 *
 * Функция, а не импорт проекции: иначе `reader → project → reader` дал бы
 * цикл модулей. Секцию `needs` источника и секцию узла графа считает один и
 * тот же код, поэтому источник получает значения, проверенные теми же
 * схемами полей.
 */
export type SectionProjector = (
  declaration: SectionDeclaration,
  reader: ConfigReader,
) => unknown;

/**
 * Умолчание проектора: читалка создана вне фазы 0.
 *
 * Проекция нужна только источнику с `needs`, поэтому отсутствие проектора
 * замечается там же — с именем секции, которую некому спроецировать.
 */
const projectorMissing: SectionProjector = (declaration) => {
  throw new Error(
    `Config section '${declaration.prefix}' is needed by a source, but this ` +
      `reader was created without a section projector. Phase 0 supplies it: ` +
      `create the reader with bootstrapConfig().`,
  );
};

/** Запись, ждущая подключения логгера */
interface PendingLog {
  readonly level: 'debug' | 'warn';
  readonly message: string;
}

/** Привязка в разобранном виде */
interface ResolvedBinding {
  readonly source: ConfigSource<unknown>;
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
  readonly #pending: PendingLog[] = [];

  #logger?: Logger;

  /** Проекция секции `needs` — приходит от фазы 0 */
  readonly #project: SectionProjector;

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

  constructor(
    bindings: readonly Binding[] = [],
    project: SectionProjector = projectorMissing,
  ) {
    this.#bindings = bindings.map((binding, index) => ({
      source: binding.source,
      keys: binding.keys,
      optional: binding.optional,
      timeout: binding.timeout,
      name: binding.source.name ?? `source #${index + 1}`,
    }));
    this.#project = project;
  }

  /**
   * Фаза 0: поднимает источники, снимает снимок объявленных ключей и
   * сверяет области с реестром.
   *
   * Очерёдность подъёма выводится из `needs`, а не из порядка списка:
   * источник поднимается после привязок, покрывающих ключи его секции
   * координат. Порядок списка остаётся приоритетом разрешения ключа, и
   * Vault, стоящий выше `.env`, поднимается после него.
   *
   * `init()` каждого источника зовётся один раз, с границей `timeout`.
   * Привязка с `optional: true`, чей `init()` отказал, не уложился в
   * границу или остался без координат, пропускается — фаза 0 продолжается
   * без этого источника вместо отказа. Повторы при временно недоступном
   * источнике — забота самого источника: цену и уместность повтора знает
   * он, ядру нечем отличить временный отказ от постоянного.
   *
   * Наблюдение навешивается после инициализации: до неё источнику нечего
   * сообщать, а секции ещё не спроецированы.
   *
   * @throws {ConfigSourceCycleError} Если привязки ссылаются друг на друга
   * через `needs`
   * @throws {ConfigNeedsDeclarationError} Если секция `needs` не объявлена
   * или объявлена `makeConfig.reloadable`
   * @throws {ConfigSourceNeedsError} Если секция `needs` не спроецировалась,
   * а привязка не `optional`
   * @throws {ConfigSourceError} Если `init()` источника отказал или не
   * уложился в `timeout`, а привязка не `optional`
   */
  async init(): Promise<void> {
    const order = this.#raiseOrder();
    const raised = new Set<ResolvedBinding>();

    if (order.length > 0) {
      this.#log(
        'debug',
        `config sources are raised in this order: ${order
          .map((binding) => binding.name)
          .join(', ')}`,
      );
    }

    for (const binding of order) {
      // До `try`: дефект объявления секции координат чинится в коде, а не
      // ожиданием внешней системы, поэтому `optional` его не проглатывает
      const declaration = this.#needsDeclaration(binding);

      try {
        const values = declaration
          ? this.#projectNeeds(binding, declaration, raised)
          : undefined;

        await this.#initOne(binding, values);
      } catch (error) {
        if (binding.optional) {
          this.#skipped.add(binding);
          continue;
        }

        throw error instanceof ConfigSourceNeedsError
          ? error
          : new ConfigSourceError(binding.name, error);
      }

      raised.add(binding);
    }

    this.#warnAboutEmptyTargets();

    for (const key of declaredKeys()) {
      // Ключи секции координат уже лежат в снимке: источник поднимался по
      // ним, и перечитывание сменило бы их значением источника, который
      // поднялся позже
      if (this.#snapshot.has(key)) {
        continue;
      }

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
    this.#log('warn', message);
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

    for (const entry of this.#pending.splice(0)) {
      logger[entry.level](entry.message);
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
   * Запись в логгер ядра, если он подключён, иначе в буфер до подключения.
   */
  #log(level: PendingLog['level'], message: string): void {
    if (this.#logger) {
      this.#logger[level](message);
    } else {
      this.#pending.push({ level, message });
    }
  }

  /**
   * Вызывает `init()` источника с границей `timeout` этой привязки.
   *
   * `Promise.race` с таймером: источник без `init()` разрешается сразу.
   *
   * @param binding - Привязка поднимаемого источника
   * @param values - Проекция секции `needs`; `undefined` у источника без неё
   */
  async #initOne(binding: ResolvedBinding, values: unknown): Promise<void> {
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
      await Promise.race([
        Promise.resolve(binding.source.init(values)),
        timeout,
      ]);
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
   *
   * Привязка не отвечает за ключи, которые называет секция `needs` её
   * собственного источника: иначе координаты Vault искались бы в самом
   * Vault, и привязка без `keys` давала бы цикл. Правило живёт здесь одно
   * на все чтения — и на проекцию секции координат, и на любое позднейшее.
   *
   * @param key - Имя ключа
   * @param scope - Привязки, у которых спрашивать; умолчание — все
   * поднявшиеся. Фаза 0 сужает область до источников, поднятых раньше
   */
  #lookup(
    key: string,
    scope: readonly ResolvedBinding[] = this.#active(),
  ): unknown {
    for (const binding of scope) {
      if (!targetCovers(binding.keys, key) || this.#isOwnNeeds(binding, key)) {
        continue;
      }

      const value = binding.source.get(key);
      if (value !== undefined) {
        return value;
      }
    }

    return undefined;
  }

  /** Называет ли ключ секция `needs` источника этой привязки */
  #isOwnNeeds(binding: ResolvedBinding, key: string): boolean {
    return binding.source.needs?.keys.names.includes(key) ?? false;
  }

  /**
   * Порядок подъёма: топологический по `needs`, стабильный по списку.
   *
   * Привязка `A` идёт после привязки `B`, если таргет `B` покрывает хотя бы
   * один ключ секции `A.needs`. Покрытие считается по таргету, а не по
   * наличию значения: значений до подъёма не существует. Сама себе
   * привязка предшественником не становится — её `needs`-ключи она не
   * обслуживает.
   *
   * Из привязок, готовых к подъёму, выбирается первая по списку, поэтому
   * не связанные зависимостью источники поднимаются в порядке списка.
   *
   * @throws {ConfigSourceCycleError} Если привязки ссылаются друг на друга
   */
  #raiseOrder(): readonly ResolvedBinding[] {
    const predecessors = new Map<ResolvedBinding, readonly ResolvedBinding[]>();

    for (const binding of this.#bindings) {
      const names = binding.source.needs?.keys.names ?? [];

      predecessors.set(
        binding,
        names.length === 0
          ? []
          : this.#bindings.filter(
              (candidate) =>
                candidate !== binding &&
                names.some((key) => targetCovers(candidate.keys, key)),
            ),
      );
    }

    const order: ResolvedBinding[] = [];
    const placed = new Set<ResolvedBinding>();

    while (order.length < this.#bindings.length) {
      const next = this.#bindings.find(
        (binding) =>
          !placed.has(binding) &&
          (predecessors.get(binding) ?? []).every((dep) => placed.has(dep)),
      );

      if (!next) {
        throw new ConfigSourceCycleError(
          this.#cycleChain(predecessors, placed),
        );
      }

      order.push(next);
      placed.add(next);
    }

    return order;
  }

  /**
   * Цепочка имён цикла для текста отказа.
   *
   * Путь строится по предшественникам — в том же направлении, в каком
   * читается сообщение: `a → b → a` значит «`a` ждёт `b`, `b` ждёт `a`».
   * Каждая неразмещённая привязка ждёт хотя бы одну неразмещённую, иначе
   * она была бы размещена, поэтому путь замыкается.
   */
  #cycleChain(
    predecessors: ReadonlyMap<ResolvedBinding, readonly ResolvedBinding[]>,
    placed: ReadonlySet<ResolvedBinding>,
  ): readonly string[] {
    const path: ResolvedBinding[] = [];
    let current = this.#bindings.find((binding) => !placed.has(binding));

    while (current && !path.includes(current)) {
      path.push(current);
      current = (predecessors.get(current) ?? []).find(
        (dep) => !placed.has(dep),
      );
    }

    // Хвост до входа в цикл отбрасывается: привязка, которая лишь ждёт
    // цикл, сама в него не входит и чинится не здесь
    const cycle = current ? path.slice(path.indexOf(current)) : path;

    return [...cycle, ...cycle.slice(0, 1)].map((binding) => binding.name);
  }

  /**
   * Декларация секции `needs` этой привязки или `undefined`, если источник
   * координат ниоткуда не берёт.
   *
   * @throws {ConfigNeedsDeclarationError} Если секции нет в реестре или она
   * объявлена `makeConfig.reloadable`
   */
  #needsDeclaration(binding: ResolvedBinding): SectionDeclaration | undefined {
    const needs = binding.source.needs;

    if (!needs) {
      return undefined;
    }

    const prefix = needs.keys.prefix;
    const declaration = lookupSection(prefix);

    if (!declaration) {
      throw new ConfigNeedsDeclarationError(binding.name, prefix, 'undeclared');
    }

    if (declaration.reloadable) {
      throw new ConfigNeedsDeclarationError(binding.name, prefix, 'reloadable');
    }

    return declaration;
  }

  /**
   * Проецирует секцию координат из источников, поднятых раньше, и кладёт
   * значения её ключей в снимок.
   *
   * Снимком порядок и держится: финальный проход по объявленным ключам эти
   * значения не перечитывает, поэтому источник, поднявшийся позже, координат
   * уже не меняет.
   *
   * @param binding - Привязка поднимаемого источника
   * @param declaration - Декларация его секции `needs`
   * @param raised - Привязки, чьи источники уже поднялись
   * @returns Проверенные значения секции — их получает `init()`
   * @throws {ConfigSourceNeedsError} Если секция не спроецировалась
   */
  #projectNeeds(
    binding: ResolvedBinding,
    declaration: SectionDeclaration,
    raised: ReadonlySet<ResolvedBinding>,
  ): unknown {
    const scope = this.#bindings.filter((candidate) => raised.has(candidate));

    for (const field of declaration.fields) {
      this.#snapshot.set(field.key, this.#lookup(field.key, scope));
    }

    try {
      const values = this.#project(declaration, this);

      // Секцию прочитал источник, а не узел графа, но прочитана она
      // по-настоящему: непотреблённой она больше не считается
      declaration.consumed = true;

      return values;
    } catch (error) {
      const missing = declaration.fields
        .filter(
          (field) => presentValue(this.#snapshot.get(field.key)) === undefined,
        )
        .map((field) => field.key);

      throw new ConfigSourceNeedsError(
        binding.name,
        declaration.prefix,
        missing,
        scope.map((candidate) => candidate.name),
        error,
      );
    }
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
