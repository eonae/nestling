import type { InjectionToken } from '../common.js';

/**
 * Роль класса: чем он является в составе приложения.
 *
 * Роль объявляется декоратором и держит позицию: компонент и ресурс живут
 * в `providers:`, хендлер — в слоте `handler:` декларации. Форму класса
 * проверяет компилятор, позицию — сверка роли на фазе ASSEMBLE.
 */
export type ClassRole = 'component' | 'resource' | 'handler';

/** Метаданные класса с декоратором роли: роль и список зависимостей. */
export interface RoleMetadata {
  /** Роль класса */
  role: ClassRole;
  /**
   * DI-токены зависимостей. У компонента и хендлера они приходят в
   * конструктор, у ресурса — в `static acquire` перед сигналом.
   */
  dependencies: InjectionToken[];
}

/**
 * Метаданные всех классов с декоратором роли. `WeakMap` освобождает
 * запись, когда на класс не остаётся ссылок.
 *
 * Хранилище не экспортируется даже под пометкой `@internal`: пакет
 * собирается `tsc`, и экспорт из барреля попал бы в публичный `.d.ts`.
 * Оттуда запись мимо декоратора обошла бы проверку соответствия списка
 * зависимостей параметрам роли. Наружу идёт только чтение — `readRoleMeta`.
 */
const roleMetaStorage = new WeakMap<object, RoleMetadata>();

/**
 * Возвращает метаданные класса или `undefined`, если у класса нет
 * декоратора роли.
 *
 * @param target - Класс
 * @returns Роль и зависимости или `undefined`
 */
export function readRoleMeta(target: object): RoleMetadata | undefined {
  return roleMetaStorage.get(target);
}

/**
 * Записывает метаданные класса. Вызывается только декоратором роли, который
 * и проверяет их согласованность с параметрами.
 *
 * @param target - Класс
 * @param metadata - Роль и зависимости
 */
export function writeRoleMeta(target: object, metadata: RoleMetadata): void {
  roleMetaStorage.set(target, metadata);
}

/**
 * Название декоратора роли — для текстов ошибок.
 *
 * @param role - Роль класса
 * @returns Имя декоратора с собакой
 */
export const decoratorOf = (role: ClassRole): string =>
  ({
    component: '@Component',
    resource: '@Resource',
    handler: '@Handler',
  })[role];
