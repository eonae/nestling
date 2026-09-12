import type { InjectionToken, UnwrapInjectionTokens } from '../common.js';

import type { ClassRole } from './role.metadata.js';
import { writeRoleMeta } from './role.metadata.js';
import { resolveAutoDependency } from './token-family.js';

/**
 * Тип-ошибка формы класса: класс не той роли, что называет декоратор.
 *
 * Поля перечислены отображённым типом, а не литералом: иначе TypeScript
 * печатает имя алиаса, и текст `__error` в диагностике пропадает.
 */
type RoleShapeError<Message extends string, Decorator extends string> = {
  [K in keyof {
    __error: unknown;
    use: unknown;
  }]: K extends '__error' ? Message : Decorator;
};

/**
 * Тип-ошибка: список зависимостей не той длины, что список параметров.
 *
 * Та же форма, что у ошибки роли: первая строка диагностики называет
 * `__error`, следующие — ожидаемое и фактическое.
 */
type DependencyLengthError<Expected, Actual> = {
  [K in keyof {
    __error: unknown;
    expected: unknown;
    actual: unknown;
  }]: K extends '__error'
    ? 'Dependency list length does not match the parameter list'
    : K extends 'expected'
      ? Expected
      : Actual;
};

/**
 * Проверяет длину списка зависимостей против конструктора.
 *
 * Длина `ConstructorParameters<T>` — объединение у конструктора с
 * необязательными параметрами (`1 | 2`) и `number` у конструктора с
 * rest-параметром, поэтому `extends` принимает оба случая. Совпало —
 * `unknown`, который в пересечении с `T` ничего не меняет; не совпало —
 * тип-ошибка, и класс перестаёт подходить под параметр декоратора.
 *
 * Длину проверяет только компилятор. `Function.length` в рантайме не
 * отличает необязательный параметр от отсутствующего — `logger?: Logger`
 * он считает наравне с обязательным, — поэтому та же проверка на значении
 * отвергала бы список, который компилятор принимает.
 */
type ValidConstructorLength<
  T extends abstract new (...args: any) => any,
  TDependencies extends readonly unknown[],
> = TDependencies['length'] extends ConstructorParameters<T>['length']
  ? unknown
  : DependencyLengthError<
      ConstructorParameters<T>['length'],
      TDependencies['length']
    >;

/** Метод `handle`: форма класса-хендлера. */
interface HandlerShape {
  handle(...args: any[]): any;
}

/** Метод `release`: то, что ресурс обязан уметь отпускать. */
interface Releasable {
  release(): void | Promise<void>;
}

/**
 * Форма класса-ресурса: статический захват, отдающий отпускаемое значение.
 *
 * `Args` — значения списка зависимостей; сигнал остановки старта идёт
 * последним параметром и в список не входит.
 */
interface ResourceShape<Args extends readonly unknown[]> {
  acquire(...args: [...Args, AbortSignal]): Promise<Releasable>;
}

/** Параметры `static acquire` без последнего — эталон списка ресурса. */
type AcquireDependencies<T> = T extends {
  acquire(...args: infer P): any;
}
  ? P extends [...infer Head, unknown]
    ? Head
    : []
  : [];

/** Проверяет длину списка зависимостей против параметров `acquire`. */
type ValidAcquireLength<
  T,
  TDependencies extends readonly unknown[],
> = TDependencies['length'] extends AcquireDependencies<T>['length']
  ? unknown
  : DependencyLengthError<
      AcquireDependencies<T>['length'],
      TDependencies['length']
    >;

/**
 * Отвергает класс чужой формы: метод `handle` — это хендлер, статический
 * `acquire` — ресурс.
 *
 * Запрет выражается пересечением, а не ограничением `extends`: ограничение
 * умеет требовать член, но не умеет его запрещать.
 *
 * Форма хендлера сравнивается с типом экземпляра, и `any` в этой позиции
 * совпадением не считается. Когда класс не проходит ограничение параметра
 * декоратора, TypeScript печатает само ограничение — `new (...) => any`, —
 * и `any` в позиции экземпляра подходит под любую форму. Без отсечки текст
 * про `@Handler` попадал бы в диагностику любой другой причины, например
 * неверной длины списка зависимостей. Приём `0 extends 1 & Instance`
 * истинен только для `any`.
 *
 * Хендлеру такая отсечка не нужна: у `@Handler` наличие `handle` —
 * требование, а не запрет, и `any` проходит под требование молча.
 */
type ValidComponentShape<T> = T extends { acquire(...args: any[]): any }
  ? RoleShapeError<
      'A class with a static acquire is a resource, not a component',
      '@Resource'
    >
  : T extends abstract new (...args: any) => infer Instance
    ? 0 extends 1 & Instance
      ? unknown
      : Instance extends HandlerShape
        ? RoleShapeError<
            'A class with a handle method is a handler, not a component',
            '@Handler'
          >
        : unknown
    : unknown;

/**
 * Записывает роль и список зависимостей в метаданные класса.
 *
 * `Family.auto` заменяется на члена здесь, при декорировании: класс
 * потребителя уже известен, поэтому в метаданные попадает обычный DI-токен
 * члена, и дальше заместителя никто не видит.
 */
function decorateRole(role: ClassRole, declared: readonly InjectionToken[]) {
  return function <T extends object>(target: T): T {
    // Имя класса нужно для `.auto` и текстов ошибок; у декорируемого
    // значения оно есть всегда — это класс
    const named = target as { readonly name: string };

    const dependencies = declared.map((dep) =>
      resolveAutoDependency(dep, named),
    );

    writeRoleMeta(target, { role, dependencies });

    return target;
  };
}

/**
 * Объявляет компонент: класс, который контейнер создаёт конструктором.
 *
 * Форма без аргумента — то же, что `@Component([])`.
 *
 * @example
 * ```typescript
 * @Component()
 * class Clock {
 *   now() { return new Date(); }
 * }
 * ```
 */
export function Component(): <T extends new () => any>(
  constructor: T & ValidComponentShape<T>,
  context: ClassDecoratorContext<T>,
) => T;

/**
 * Объявляет компонент; DI-токеном служит сам класс.
 *
 * Зависимости приходят в конструктор в порядке списка. Класс с методом
 * `handle` — хендлер, класс со `static acquire` — ресурс: их компонентом
 * объявить нельзя, это ошибка компиляции.
 *
 * @template TDependencies - Массив DI-токенов зависимостей
 * @param deps - DI-токены, передаваемые в конструктор по порядку
 *
 * @example
 * ```typescript
 * @Component([Database])
 * class UserService {
 *   constructor(private readonly db: Database) {}
 * }
 * ```
 */
export function Component<TDependencies extends InjectionToken[]>(
  deps: [...TDependencies],
): <T extends new (...args: UnwrapInjectionTokens<TDependencies>) => any>(
  constructor: T &
    ValidComponentShape<T> &
    ValidConstructorLength<T, TDependencies>,
  context: ClassDecoratorContext<T>,
) => T;

/**
 * Объявляет компонент; в зависимостях допустимы и классы, и объектные
 * DI-токены.
 *
 * @template TDependencies - Массив DI-токенов зависимостей
 * @param deps - Классы или DI-токены, передаваемые в конструктор по порядку
 */
export function Component<TDependencies extends InjectionToken[]>(
  deps: [...TDependencies],
): <T extends new (...args: UnwrapInjectionTokens<TDependencies>) => any>(
  constructor: T &
    ValidComponentShape<T> &
    ValidConstructorLength<T, TDependencies>,
  context: ClassDecoratorContext,
) => T;

export function Component<TDependencies extends InjectionToken[]>(
  deps: [...TDependencies] = [] as unknown as [...TDependencies],
) {
  return decorateRole('component', deps);
}

/**
 * Объявляет класс-хендлер декларации: класс с методом `handle`.
 *
 * Форма без аргумента — то же, что `@Handler([])`.
 *
 * @example
 * ```typescript
 * @Handler()
 * class ListUsersHandler {
 *   async handle() { … }
 * }
 * ```
 */
export function Handler(): <T extends new () => HandlerShape>(
  constructor: T,
  context: ClassDecoratorContext<T>,
) => T;

/**
 * Объявляет класс-хендлер декларации; DI-токеном служит сам класс.
 *
 * Класс живёт в слоте `handler:` декларации и регистрируется самим
 * endpoint'ом: перечислять его в `providers:` не нужно, а перечисленный —
 * ошибка фазы ASSEMBLE.
 *
 * @template TDependencies - Массив DI-токенов зависимостей
 * @param deps - DI-токены, передаваемые в конструктор по порядку
 *
 * @example
 * ```typescript
 * @Handler([UserService])
 * class CreateUserHandler {
 *   constructor(private readonly users: UserService) {}
 *   async handle(input: CreateUser) { … }
 * }
 * ```
 */
export function Handler<TDependencies extends InjectionToken[]>(
  deps: [...TDependencies],
): <
  T extends new (...args: UnwrapInjectionTokens<TDependencies>) => HandlerShape,
>(
  constructor: T & ValidConstructorLength<T, TDependencies>,
  context: ClassDecoratorContext<T>,
) => T;

/**
 * Объявляет класс-хендлер; в зависимостях допустимы и классы, и объектные
 * DI-токены.
 *
 * @template TDependencies - Массив DI-токенов зависимостей
 * @param deps - Классы или DI-токены, передаваемые в конструктор по порядку
 */
export function Handler<TDependencies extends InjectionToken[]>(
  deps: [...TDependencies],
): <
  T extends new (...args: UnwrapInjectionTokens<TDependencies>) => HandlerShape,
>(
  constructor: T & ValidConstructorLength<T, TDependencies>,
  context: ClassDecoratorContext,
) => T;

export function Handler<TDependencies extends InjectionToken[]>(
  deps: [...TDependencies] = [] as unknown as [...TDependencies],
) {
  return decorateRole('handler', deps);
}

/**
 * Объявляет ресурс: класс со `static acquire` и методом `release`.
 *
 * Форма без аргумента — то же, что `@Resource([])`.
 *
 * @example
 * ```typescript
 * @Resource()
 * class Clock {
 *   static async acquire(signal: AbortSignal): Promise<Clock> { … }
 *   async release() { … }
 * }
 * ```
 */
export function Resource(): <T extends ResourceShape<[]>>(
  constructor: T,
  context: ClassDecoratorContext<any>,
) => T;

/**
 * Объявляет ресурс; DI-токеном служит сам класс.
 *
 * Экземпляр создаёт `static acquire`: контейнер зовёт её на фазе INIT,
 * передавая значения зависимостей в порядке списка и сигнал остановки
 * старта последним аргументом. Конструктор ресурса контейнер не вызывает,
 * поэтому поля экземпляра не проходят через `undefined`. На SHUTDOWN
 * вызывается `release`.
 *
 * Эталон списка — параметры `acquire` без последнего: `signal` в список не
 * входит.
 *
 * @template TDependencies - Массив DI-токенов зависимостей
 * @param deps - DI-токены, передаваемые в `acquire` по порядку
 *
 * @example
 * ```typescript
 * @Resource([DbConfig])
 * class Database {
 *   static async acquire(config: DbConfigValues, signal: AbortSignal) {
 *     return new Database(await connect(config.url, { signal }));
 *   }
 *
 *   private constructor(private readonly pool: Pool) {}
 *
 *   async release() {
 *     await this.pool.end();
 *   }
 * }
 * ```
 */
export function Resource<TDependencies extends InjectionToken[]>(
  deps: [...TDependencies],
): <T extends ResourceShape<UnwrapInjectionTokens<TDependencies>>>(
  constructor: T & ValidAcquireLength<T, TDependencies>,
  // Контекст типизирован `any`: у ресурса конструктор бывает приватным, а
  // `ClassDecoratorContext<T>` требует публичного
  context: ClassDecoratorContext<any>,
) => T;

export function Resource<TDependencies extends InjectionToken[]>(
  deps: [...TDependencies] = [] as unknown as [...TDependencies],
) {
  return decorateRole('resource', deps);
}
