import type { InjectionToken } from '../common.js';
import { tokenId } from '../common.js';
import type { DIGraph, DINode, JsonDIGraph } from '../graph/index.js';

import type { VisitCallback, VisitOptions } from '@nestlingjs/common.graphs';

/**
 * Текст ошибки обращения к значению до фазы INIT.
 *
 * `null` здесь не годится: он означает «DI-токен не зарегистрирован» и о фазе
 * ничего не говорит. Проверить регистрацию без экземпляра умеет `has()`.
 */
const phaseErrorMessage = (token: string): string =>
  `Instance for DI token '${token}' does not exist yet: instances are created in phase INIT, ` +
  `and init() has not completed. Assembly-phase checks use has(token) instead.`;

/**
 * Собранный контейнер: граф провайдеров и слоты их значений.
 *
 * Контейнер неизменяем: регистрировать что-то после сборки нельзя.
 * `build()` проверил граф и не создал ни одного экземпляра — значения
 * появляются в `init()`, целиком и в топологическом порядке.
 *
 * @example
 * ```typescript
 * const container = new ContainerBuilder()
 *   .register(UserService)
 *   .build();
 *
 * await container.init();
 * const userService = container.get(UserService);
 * await container.destroy();
 * ```
 */
export class BuiltContainer {
  readonly #graph: DIGraph;
  readonly #pruned: readonly string[];
  readonly #warnings: readonly string[];

  /**
   * DI-токен → адрес его узла в графе.
   *
   * Поиск идёт по DI-токену, а не по его `id`: идентификатор служит
   * отображению и уникальностью не связан.
   */
  readonly #nodeIds: ReadonlyMap<InjectionToken, string>;

  /** Значения созданы: до этого аксессоры бросают ошибку фазы */
  #initialized = false;

  /** Хуки `@OnStart` выполняются один раз, а не при каждом `start()` */
  #started = false;

  constructor(
    graph: DIGraph,
    pruned: readonly string[] = [],
    nodeIds: ReadonlyMap<InjectionToken, string> = new Map(),
    warnings: readonly string[] = [],
  ) {
    this.#graph = graph;
    this.#pruned = Object.freeze([...pruned]);
    this.#nodeIds = nodeIds;
    this.#warnings = Object.freeze([...warnings]);
  }

  /**
   * Идентификаторы узлов, удалённых как поддеревья, осиротевшие после
   * подмены из `overrides`.
   *
   * Без `overrides` список пуст. Он нужен, чтобы на вопрос «почему мой
   * ресурс не захватился» отвечали данные, а не чтение исходников.
   */
  get pruned(): readonly string[] {
    return this.#pruned;
  }

  /**
   * Предупреждения сборки: сегодня это совпадающие идентификаторы DI-токенов.
   *
   * Билдер ничего не печатает: во время `build()` логгера у него нет.
   * Сборка приложения пишет список в корневой логгер после `build()`; без
   * неё список читают руками. Без предупреждений список пуст.
   */
  get warnings(): readonly string[] {
    return this.#warnings;
  }

  /**
   * Фаза INIT: создаёт значения всех узлов в топологическом порядке.
   *
   * Компонент конструируется, значение отдаётся как есть, фабрика
   * вызывается, ресурс захватывается `await acquire`. Потребитель ресурса
   * получает в конструктор уже захваченное значение.
   *
   * Провал захвата взводит сигнал `acquire` и освобождает уже захваченное
   * в обратном топологическом порядке; старт падает исходной ошибкой, а
   * ошибки `release` прикладываются к ней. Повторный вызов ничего не
   * создаёт заново.
   *
   * @param signal - Сигнал остановки старта; уходит последним аргументом
   * `acquire`
   * @throws {Error} Если конструктор, фабрика или `acquire` бросили
   *
   * @example
   * ```typescript
   * const container = builder.build();
   * await container.init();
   * ```
   */
  async init(signal?: AbortSignal): Promise<void> {
    if (this.#initialized) {
      return;
    }

    // Собственный контроллер, а не переданный сигнал: провал захвата обязан
    // свернуть захваты, которые ещё идут, а чужим каналом остановки
    // контейнер не распоряжается
    const acquisition = new AbortController();
    const forward = (): void => acquisition.abort(signal?.reason);

    signal?.addEventListener('abort', forward, { once: true });

    const acquired: DINode[] = [];

    try {
      await this.#graph.traverse(
        async (node) => {
          await (node as DINode).instantiate(acquisition.signal);

          if ((node as DINode).isResource) {
            acquired.push(node as DINode);
          }
        },
        { direction: 'topological' },
      );
    } catch (error) {
      acquisition.abort();
      await rollback(acquired, error);
      throw error;
    } finally {
      signal?.removeEventListener('abort', forward);
    }

    this.#initialized = true;
  }

  /**
   * Фаза START: выполняет хуки `@OnStart` всех узлов.
   *
   * Порядок топологический, как в `init()`: хук видит свои зависимости уже
   * запущенными. Аргументом хук получает сигнал остановки — тот же, что
   * получают транспорты в `serve`.
   *
   * Повторный вызов ничего не делает.
   *
   * @param signal - Канал остановки, передаваемый хукам
   * @throws {Error} Если любой хук бросил ошибку
   *
   * @example
   * ```typescript
   * await container.init(signal);
   * await container.start(signal);
   * ```
   */
  async start(signal: AbortSignal): Promise<void> {
    if (this.#started) {
      return;
    }
    this.#started = true;

    await this.#graph.traverse(
      async (node) => {
        await (node as DINode).runStartHooks(signal);
      },
      { direction: 'topological' },
    );
  }

  /**
   * Фаза SHUTDOWN: освобождает ресурсы в обратном топологическом порядке.
   *
   * Компонентам вызова не достаётся: освобождать им нечего. `release`
   * каждого ресурса выполняется ровно один раз, поэтому повторный вызов
   * ничего не повторяет.
   *
   * @throws {Error} Если любой `release` бросил ошибку
   *
   * @example
   * ```typescript
   * await container.destroy();
   * ```
   */
  async destroy(): Promise<void> {
    await this.#graph.traverse(
      async (node) => {
        await (node as DINode).release();
      },
      { direction: 'reverse-topological' },
    );
  }

  /**
   * Возвращает экземпляр по DI-токену.
   *
   * Не бросает ошибок для незарегистрированного DI-токена: возвращает `null`.
   * Контракт действует с фазы INIT — до неё вызов бросает ошибку фазы,
   * потому что `null` там означал бы «не зарегистрирован».
   *
   * @template T - Тип экземпляра
   * @param token - DI-токен: класс или объектный DI-токен
   * @returns Экземпляр или `null`, если DI-токен не зарегистрирован
   * @throws {Error} Если `init()` ещё не завершён
   *
   * @example
   * ```typescript
   * const userService = container.get(UserService);
   * ```
   */
  get<T>(token: InjectionToken<T>): T | null {
    const node = this.#nodeOf(token);

    if (node && !this.#initialized) {
      throw new Error(phaseErrorMessage(tokenId(token)));
    }

    return (node?.instance as T) ?? null;
  }

  /**
   * Проверяет, что DI-токен зарегистрирован, не требуя экземпляра.
   *
   * Тем и отличается от {@link get}: проверкам фазы ASSEMBLE нужен факт
   * регистрации, а экземпляров тогда ещё нет.
   *
   * @param token - DI-токен: класс или объектный DI-токен
   * @returns `true`, если у DI-токена есть узел графа
   *
   * @example
   * ```typescript
   * container.has(HttpTransport$('default'));
   * ```
   */
  has(token: InjectionToken<unknown>): boolean {
    return this.#nodeOf(token) !== undefined;
  }

  /**
   * Возвращает экземпляр по адресу узла из отчёта.
   *
   * Поверхность интроспекции: адрес попадает в `toJSON()`, в тексты
   * ошибок и в отчёты, и по нему бывает нужно достать сам экземпляр.
   * Для обычного доступа есть {@link get} — он ищет по DI-токену и не
   * зависит от того, разошлись ли идентификаторы.
   *
   * @param id - Адрес узла, как он напечатан в отчёте
   * @returns Экземпляр или `null`, если узла с таким адресом нет
   * @throws {Error} Если `init()` ещё не завершён
   */
  getById(id: string): unknown {
    const node = this.#graph.getNode(id);

    if (node && !this.#initialized) {
      throw new Error(phaseErrorMessage(id));
    }

    return node?.instance ?? null;
  }

  /**
   * Возвращает экземпляр по DI-токену или бросает ошибку.
   *
   * Наличие определяется регистрацией DI-токена, а не значением:
   * зарегистрированные `0`, `''` и `false` возвращаются как есть.
   *
   * @template T - Тип экземпляра
   * @param token - DI-токен: класс или объектный DI-токен
   * @returns Экземпляр
   * @throws {Error} Если DI-токен не зарегистрирован или `init()` ещё не
   * завершён — это две разные ошибки с разными текстами
   *
   * @example
   * ```typescript
   * const userService = container.getOrThrow(UserService);
   * ```
   */
  getOrThrow<T>(token: InjectionToken<T>): T {
    const node = this.#nodeOf(token);

    if (!node) {
      throw new Error(`Instance for DI token '${tokenId(token)}' not found`);
    }

    if (!this.#initialized) {
      throw new Error(phaseErrorMessage(tokenId(token)));
    }

    return node.instance as T;
  }

  /**
   * Перебирает узлы графа синхронно, вызывая `callback` на каждом.
   *
   * Работает до INIT: обход читает метаданные и рёбра, а не значения.
   *
   * Отличие от {@link traverse}: тот ждёт колбэк, потому что его дело —
   * фазы жизненного цикла. Проверкам фазы сборки ждать нечего, а сама фаза
   * синхронна.
   *
   * Порядка обхода нет: проверка утверждает что-то про каждый узел, а не
   * про их последовательность.
   *
   * @param callback - Функция, вызываемая для каждого узла
   */
  forEachNode(callback: (node: Readonly<DINode>) => void): void {
    this.#graph.forEachNode(callback);
  }

  /**
   * Обходит граф зависимостей, вызывая `callback` для каждого узла.
   *
   * @param callback - Функция, вызываемая для каждого узла
   * @param options - Опции обхода: направление, фильтры
   */
  async traverse(
    callback: VisitCallback<DINode>,
    options: VisitOptions<DINode> = {},
  ): Promise<void> {
    return await this.#graph.traverse(callback, options);
  }

  /**
   * Возвращает граф зависимостей в виде JSON — для визуализации и анализа.
   *
   * @returns JSON-представление графа
   */
  async toJSON(): Promise<JsonDIGraph> {
    return await this.#graph.toJSON();
  }

  /** Узел DI-токена или `undefined`, если DI-токен не зарегистрирован */
  #nodeOf(token: InjectionToken<unknown>): DINode | undefined {
    const id = this.#nodeIds.get(token as InjectionToken);

    return id === undefined ? undefined : this.#graph.getNode(id);
  }
}

/**
 * Освобождает захваченное в обратном топологическом порядке и
 * прикладывает ошибки `release` к причине провала.
 *
 * Причину не подменяет: автору нужна первая ошибка — та, из-за которой
 * захват не состоялся, — а не последняя.
 */
async function rollback(
  acquired: readonly DINode[],
  cause: unknown,
): Promise<void> {
  const failures: unknown[] = [];

  for (const node of [...acquired].reverse()) {
    try {
      await node.release();
    } catch (error) {
      failures.push(error);
    }
  }

  if (failures.length === 0 || !(cause instanceof Error)) {
    return;
  }

  const message = 'release failed while rolling back a failed acquire';

  cause.cause =
    cause.cause === undefined
      ? failures.length === 1
        ? failures[0]
        : new AggregateError(failures, message)
      : new AggregateError([cause.cause, ...failures], message);
}
