import type { ModuleProvider, ProvidersFactory } from '../providers';

/**
 * Модуль: обычный объект, который группирует провайдеры и импортирует другие
 * модули.
 *
 * @example
 * ```typescript
 * const userModule: Module = {
 *   name: 'UserModule',
 *   providers: [UserService, UserRepository],
 *   imports: [DatabaseModule]
 * };
 * ```
 */
export interface Module {
  /** Уникальное имя модуля */
  name: string;
  /**
   * Провайдеры модуля: классы с `@Injectable`, определения провайдеров,
   * рецепты семейств (`familyProvider(...)`) или фабрика, возвращающая их
   */
  providers?: ModuleProvider[] | ProvidersFactory;
  /** Модули, от которых зависит этот модуль */
  imports?: Module[];
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
