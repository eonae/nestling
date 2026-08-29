import type { InjectionToken } from '../common';
import type {
  ModuleProvider,
  ProvidersFactory,
  TokenFamily,
} from '../providers';

/**
 * Модуль: обычный объект, который группирует провайдеры, импортирует другие
 * модули и объявляет, какие токены экспортирует.
 *
 * @example
 * ```typescript
 * const userModule: Module = {
 *   name: 'UserModule',
 *   providers: [UserService, UserRepository],
 *   imports: [DatabaseModule],
 *   exports: [UserService]
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
  /**
   * Токены, которые модуль отдаёт другим модулям.
   *
   * Семейство в `exports` означает «все созданные члены семейства
   * экспортированы». Учитывается только при `strictExports`.
   */
  exports?: (InjectionToken | TokenFamily<any, any>)[];
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
