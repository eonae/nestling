import type {
  Constructor,
  InjectionToken,
  Token,
  UnwrapInjectionTokens,
} from '../common';

import { injectableMetaStorage } from './injectable.metadata';
import { resolveAutoDependency } from './token-family';

/**
 * Помечает класс как провайдер с явным токеном.
 *
 * Используется, когда класс реализует интерфейс и регистрируется под
 * токеном этого интерфейса.
 *
 * @template I - Интерфейс, который реализует класс
 * @template TDependencies - Массив токенов зависимостей
 * @param id - Токен интерфейса, созданный `makeToken`
 * @param dependencies - Токены, передаваемые в конструктор по порядку
 *
 * @example
 * ```typescript
 * interface ILogger {
 *   log(message: string): void;
 * }
 * const ILogger = makeToken<ILogger>('ILogger');
 *
 * @Injectable(ILogger, [])
 * class ConsoleLogger implements ILogger {
 *   log(message: string) { console.log(message); }
 * }
 * ```
 */
export function Injectable<I, TDependencies extends InjectionToken[]>(
  id: Token<I>,
  dependencies: [...TDependencies],
): <T extends new (...args: UnwrapInjectionTokens<TDependencies>) => I>(
  constructor: T,
  context: ClassDecoratorContext<T>,
) => T;

/**
 * Помечает класс как провайдер без зависимостей; токеном служит сам класс.
 *
 * То же, что `@Injectable([])`: форма без аргумента для класса, у
 * которого конструктору нечего передавать.
 *
 * @example
 * ```typescript
 * @Injectable()
 * class ListUsersHandler {
 *   async handle() { … }
 * }
 * ```
 */
export function Injectable(): <T extends new () => any>(
  constructor: T,
  context: ClassDecoratorContext<T>,
) => T;

/**
 * Помечает класс как провайдер; токеном служит сам класс.
 *
 * @template TDependencies - Массив токенов зависимостей
 * @param deps - Токены, передаваемые в конструктор по порядку
 *
 * @example
 * ```typescript
 * @Injectable([DatabaseService])
 * class UserService {
 *   constructor(private db: DatabaseService) {}
 * }
 * ```
 */
export function Injectable<TDependencies extends InjectionToken[]>(
  deps: [...TDependencies],
): <T extends new (...args: UnwrapInjectionTokens<TDependencies>) => any>(
  constructor: T,
  context: ClassDecoratorContext<T>,
) => T;

/**
 * Помечает класс как провайдер; в зависимостях допустимы и классы, и
 * объектные токены.
 *
 * @template TDependencies - Массив токенов зависимостей
 * @param deps - Классы или токены, передаваемые в конструктор по порядку
 */
export function Injectable<TDependencies extends InjectionToken[]>(
  deps: [...TDependencies],
): <T extends new (...args: UnwrapInjectionTokens<TDependencies>) => any>(
  constructor: T,
  context: ClassDecoratorContext,
) => T;

export function Injectable<I, TDependencies extends InjectionToken[]>(
  idOrDependencies: Token<I> | [...TDependencies] = [] as unknown as [
    ...TDependencies,
  ],
  deps?: [...TDependencies],
) {
  // Перегрузки выше проверяют типами, что класс реализует интерфейс `id`,
  // а аргументы его конструктора совпадают по типу и порядку со списком
  // зависимостей. Здесь остаётся только записать метаданные.
  return function <T extends Constructor>(
    constructor: T,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _: ClassDecoratorContext<T>,
  ) {
    // Форму различает вид аргумента: список зависимостей — массив, токен
    // интерфейса — объект. Токеном класса без явного `id` служит сам
    // класс: его идентичность и есть ссылка на конструктор
    const explicitToken = Array.isArray(idOrDependencies)
      ? undefined
      : idOrDependencies;

    const injectionToken: InjectionToken =
      explicitToken ?? (constructor as Constructor);

    const declared = explicitToken
      ? deps || []
      : (idOrDependencies as [...TDependencies]);

    // `Family.auto` заменяется на члена здесь, при декорировании: класс
    // потребителя уже известен, поэтому в метаданные попадает обычный
    // токен члена, и дальше заместитель никто не видит.
    const dependencies = declared.map((dep) =>
      resolveAutoDependency(dep, constructor),
    );

    injectableMetaStorage.set(constructor, { injectionToken, dependencies });
    return constructor;
  };
}
