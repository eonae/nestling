import type { Constructor, InjectionToken } from '../common.js';

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
 * Хранилище не экспортируется даже под пометкой `@internal`: пакет
 * собирается `tsc`, и экспорт из барреля попал бы в публичный `.d.ts`.
 * Оттуда запись мимо декоратора обошла бы проверку соответствия списка
 * зависимостей конструктору, которую даёт `@Injectable`. Наружу идёт
 * только чтение — `readInjectableMeta`.
 */
const injectableMetaStorage = new WeakMap<Constructor, InjectableMetadata>();

/**
 * Возвращает метаданные класса или `undefined`, если класс не помечен
 * `@Injectable`.
 */
export function readInjectableMeta(
  target: Constructor,
): InjectableMetadata | undefined {
  return injectableMetaStorage.get(target);
}

/**
 * Записывает метаданные класса. Вызывается только декоратором
 * `@Injectable`, который и проверяет их согласованность с конструктором.
 */
export function writeInjectableMeta(
  target: Constructor,
  metadata: InjectableMetadata,
): void {
  injectableMetaStorage.set(target, metadata);
}
