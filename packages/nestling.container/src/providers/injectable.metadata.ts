import type { Constructor, InjectionToken } from '../common';

/** Метаданные класса с `@Injectable`: токен и зависимости. */
interface InjectableMetadata<T = unknown> {
  /** Токен, под которым класс регистрируется в контейнере */
  injectionToken: InjectionToken<T>;
  /** Токены зависимостей, передаваемых в конструктор */
  dependencies: InjectionToken[];
}

/**
 * Метаданные всех классов с `@Injectable`. `WeakMap` освобождает запись,
 * когда на класс не остаётся ссылок.
 *
 * @internal
 */
export const injectableMetaStorage = new WeakMap<
  Constructor,
  InjectableMetadata
>();
