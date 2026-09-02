import type { InjectionToken } from '../common';
import { tokenId } from '../common';
import type { DIGraph, DINode, JsonDIGraph } from '../graph';

import type { VisitCallback, VisitOptions } from '@common/graphs';

/**
 * Собранный контейнер с созданными экземплярами.
 *
 * Контейнер неизменяем: он отдаёт экземпляры, выполняет хуки жизненного
 * цикла и обходит граф зависимостей. Регистрировать что-то после сборки
 * нельзя.
 *
 * @example
 * ```typescript
 * const container = await new ContainerBuilder()
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

  /**
   * Токен → адрес его узла в графе.
   *
   * Поиск идёт по токену, а не по его `id`: идентификатор служит
   * отображению и уникальностью не связан.
   */
  readonly #nodeIds: ReadonlyMap<InjectionToken, string>;

  /** Хуки `@OnStart` выполняются один раз, а не при каждом `start()` */
  #started = false;

  constructor(
    graph: DIGraph,
    pruned: readonly string[] = [],
    nodeIds: ReadonlyMap<InjectionToken, string> = new Map(),
  ) {
    this.#graph = graph;
    this.#pruned = Object.freeze([...pruned]);
    this.#nodeIds = nodeIds;
  }

  /**
   * Идентификаторы узлов, удалённых как поддеревья, осиротевшие после
   * подмены из `overrides`.
   *
   * Без `overrides` список пуст. Он нужен, чтобы на вопрос «почему мой
   * `@OnInit` не выполнился» отвечали данные, а не чтение исходников.
   */
  get pruned(): readonly string[] {
    return this.#pruned;
  }

  /**
   * Выполняет хуки `@OnInit` всех провайдеров.
   *
   * Порядок топологический: сначала зависимости, потом те, кто от них
   * зависит.
   *
   * @throws {Error} Если любой хук бросил ошибку
   *
   * @example
   * ```typescript
   * const container = await builder.build();
   * await container.init(); // все хуки @OnInit
   * ```
   */
  async init(): Promise<void> {
    await this.#graph.traverse(
      async (node) => {
        await node.runInitHooks();
      },
      { direction: 'topological' },
    );
  }

  /**
   * Выполняет хуки `@OnStart` всех провайдеров.
   *
   * Порядок топологический, как в `init()`: хук видит свои зависимости
   * уже запущенными. Сама фаза идёт после `init()` всего графа и после
   * WIRE; этим `@OnStart` отличается от `@OnInit`.
   *
   * Повторный вызов ничего не делает.
   *
   * @throws {Error} Если любой хук бросил ошибку
   *
   * @example
   * ```typescript
   * await container.init();
   * await container.start(); // все хуки @OnStart
   * ```
   */
  async start(): Promise<void> {
    if (this.#started) {
      return;
    }
    this.#started = true;

    await this.#graph.traverse(
      async (node) => {
        await node.runStartHooks();
      },
      { direction: 'topological' },
    );
  }

  /**
   * Выполняет хуки `@OnDestroy` всех провайдеров.
   *
   * Порядок обратный топологическому: сначала зависимые, потом их
   * зависимости.
   *
   * @throws {Error} Если любой хук бросил ошибку
   *
   * @example
   * ```typescript
   * await container.destroy(); // все хуки @OnDestroy
   * ```
   */
  async destroy(): Promise<void> {
    await this.#graph.traverse(
      async (node) => {
        await node.runDestroyHooks();
      },
      { direction: 'reverse-topological' },
    );
  }

  /**
   * Возвращает экземпляр по токену.
   *
   * Не бросает ошибок: для незарегистрированного токена возвращает `null`.
   * Зарегистрированное значение `null` или `undefined` неотличимо от
   * незарегистрированного токена; чтобы проверить наличие, используйте
   * {@link getOrThrow}.
   *
   * @template T - Тип экземпляра
   * @param token - Токен: класс или объектный токен
   * @returns Экземпляр или `null`, если токен не зарегистрирован
   *
   * @example
   * ```typescript
   * const userService = container.get(UserService);
   * const logger = container.get(ILogger);
   * ```
   */
  get<T>(token: InjectionToken<T>): T | null {
    const id = this.#nodeIds.get(token as InjectionToken);

    const node = id === undefined ? undefined : this.#graph.getNode(id);

    return (node?.instance as T) ?? null;
  }

  /**
   * Возвращает экземпляр по адресу узла из отчёта.
   *
   * Поверхность интроспекции: адрес попадает в `toJSON()`, в тексты
   * ошибок и в отчёты, и по нему бывает нужно достать сам экземпляр.
   * Для обычного доступа есть {@link get} — он ищет по токену и не
   * зависит от того, разошлись ли идентификаторы.
   *
   * @param id - Адрес узла, как он напечатан в отчёте
   * @returns Экземпляр или `null`, если узла с таким адресом нет
   */
  getById(id: string): unknown {
    return this.#graph.getNode(id)?.instance ?? null;
  }

  /**
   * Возвращает экземпляр по токену или бросает ошибку.
   *
   * Наличие определяется регистрацией токена, а не значением:
   * зарегистрированные `0`, `''` и `false` возвращаются как есть.
   *
   * @template T - Тип экземпляра
   * @param token - Токен: класс или объектный токен
   * @returns Экземпляр
   * @throws {Error} Если токен не зарегистрирован
   *
   * @example
   * ```typescript
   * const userService = container.getOrThrow(UserService);
   * ```
   */
  getOrThrow<T>(token: InjectionToken<T>): T {
    const id = this.#nodeIds.get(token as InjectionToken);

    const node = id === undefined ? undefined : this.#graph.getNode(id);
    if (!node) {
      throw new Error(`Instance for token '${tokenId(token)}' not found`);
    }

    return node.instance as T;
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
}
