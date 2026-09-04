import type {
  Constructor,
  InjectionToken,
  Token,
  UnwrapInjectionTokens,
} from '../common.js';

import { writeInjectableMeta } from './injectable.metadata.js';
import { resolveAutoDependency } from './token-family.js';

/**
 * Тип-ошибка: список зависимостей длиннее списка параметров конструктора.
 *
 * Поля перечислены отображённым типом, а не литералом: иначе TypeScript
 * печатает имя алиаса, и текст `__error` в диагностике пропадает.
 */
type DependencyLengthError<Expected, Actual> = {
  [K in keyof {
    __error: unknown;
    expected: unknown;
    actual: unknown;
  }]: K extends '__error'
    ? 'Dependency list is longer than the constructor parameter list'
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
 * отличает необязательный параметр от отсутствующего — `logger?: ILogger`
 * он считает наравне с обязательным, — поэтому та же проверка на значении
 * отвергала бы список, который компилятор принимает.
 */
type ValidDependencyLength<
  T extends Constructor,
  TDependencies extends readonly unknown[],
> = TDependencies['length'] extends ConstructorParameters<T>['length']
  ? unknown
  : DependencyLengthError<
      ConstructorParameters<T>['length'],
      TDependencies['length']
    >;

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
  constructor: T & ValidDependencyLength<T, TDependencies>,
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
  constructor: T & ValidDependencyLength<T, TDependencies>,
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
  constructor: T & ValidDependencyLength<T, TDependencies>,
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

    writeInjectableMeta(constructor, { injectionToken, dependencies });
    return constructor;
  };
}
