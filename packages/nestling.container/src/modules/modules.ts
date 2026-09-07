import type { ModuleProvider, ProvidersFactory } from '../providers/index.js';
import type { Branchable } from '../switches/index.js';

/**
 * Модуль: обычный объект, который группирует провайдеры под именем.
 *
 * Имя модуля — метка принадлежности: узлы графа, созданные из его
 * провайдеров, несут её в метаданных. Ничего, кроме группировки, модуль
 * контейнеру не даёт: провайдеры видны всем, кто может импортировать
 * DI-токен.
 *
 * @example
 * ```typescript
 * const userModule: Module = {
 *   name: 'UserModule',
 *   providers: [UserService, UserRepository],
 *   dependsOn: [DatabaseModule]
 * };
 * ```
 */
export interface Module {
  /** Уникальное имя модуля */
  name: string;
  /**
   * Провайдеры модуля: классы с декоратором роли, определения провайдеров,
   * рецепты семейств (`familyProvider(...)`), ветки переключателей или
   * фабрика, возвращающая провайдеры
   */
  providers?: readonly Branchable<ModuleProvider>[] | ProvidersFactory;
  /**
   * Модули, без которых этот не работает: они регистрируются вместе с ним.
   *
   * Поле не даёт доступа к чужим провайдерам — доступ даёт DI-токен, а
   * провайдеры глобальны. Ветка переключателя стоит здесь наравне с
   * модулем.
   */
  dependsOn?: readonly Branchable<Module>[];
}

/**
 * Создаёт модуль. Функция возвращает свой аргумент; её роль — проверка
 * типа объекта.
 *
 * @param mod - Описание модуля
 * @returns То же описание
 *
 * @example
 * ```typescript
 * const myModule = makeModule({
 *   name: 'MyModule',
 *   providers: [MyService]
 * });
 * ```
 */
export const makeModule = (mod: Module): Module => mod;

/**
 * Проверяет, что значение — модуль.
 *
 * @param item - Проверяемое значение
 * @returns `true`, если это `Module`
 */
export const isModule = (item: any): item is Module =>
  typeof item === 'object' && item !== null && typeof item.name === 'string';
