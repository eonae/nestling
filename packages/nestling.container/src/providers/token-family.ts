import type { Constructor, InjectionToken, Token } from '../common';

/**
 * Токен члена семейства: обычный токен плюс два поля принадлежности.
 *
 * Семейство и параметр читаются полями. Разбора идентификатора нет:
 * токен, чей `id` похож на `'Family:param'`, членом от этого не
 * становится.
 *
 * @template T - Тип значения члена
 */
export interface FamilyMemberToken<T = unknown> extends Token<T> {
  /** Семейство, создавшее токен */
  readonly family: TokenFamily<T, any>;
  /** Параметр, с которым создан член */
  readonly param: string;
}

/**
 * Токен-заместитель «член по имени потребителя».
 *
 * Выделенное значение, а не член с зарезервированным параметром: у него
 * своё поле принадлежности, поэтому пользовательский параметр `'auto'`
 * с ним не сталкивается.
 *
 * @template T - Тип значения члена
 */
export interface FamilyAutoToken<T = unknown> extends Token<T> {
  /** Семейство, которому принадлежит заместитель */
  readonly autoOf: TokenFamily<T, any>;
}

/**
 * Токен-заместитель агрегата: все члены семейства одним массивом.
 *
 * Тоже выделенное значение: агрегат — не член, и рецепту семейства он
 * никогда не отдаётся.
 *
 * @template T - Тип значения одного члена
 */
export interface FamilyAllToken<T = unknown> extends Token<readonly T[]> {
  /** Семейство, которому принадлежит агрегат */
  readonly allOf: TokenFamily<T, any>;
}

/**
 * Семейство токенов: один рецепт, много членов, различаемых параметром.
 *
 * Вызов семейства возвращает мемоизированный {@link FamilyMemberToken},
 * поэтому член годится везде, где нужен токен: в `deps` у `@Injectable`
 * и фабричного провайдера, в `container.get()`. Члены создаются на сборке
 * (см. `familyProvider`), а не при обращении в рантайме.
 *
 * @template T - Тип значения каждого члена семейства
 * @template Params - Параметры члена; в V1 ровно один строковый параметр
 *
 * @example
 * ```typescript
 * const ILogger = makeTokenFamily<ILoggerService, [scope: string]>('Logger');
 *
 * ILogger('users'); // токен члена с id 'Logger:users'
 * ```
 */
export interface TokenFamily<
  T = unknown,
  Params extends [param: string] = [param: string],
> {
  /** Возвращает мемоизированный токен члена для параметра. */
  (...params: Params): FamilyMemberToken<T>;
  /** Имя семейства — префикс идентификатора каждого члена. */
  readonly familyName: string;
  /**
   * Токен-заместитель «член по имени потребителя».
   * `@Injectable([Family.auto])` записывает в метаданные класса
   * `Family('<ИмяКласса>')`.
   *
   * Разрешён только в `deps` класса с декоратором `@Injectable`.
   */
  readonly auto: FamilyAutoToken<T>;
  /**
   * Токен-заместитель агрегата: все члены семейства одним массивом.
   * Зависимость от `Family.all` заставляет `build()` создать узел, чьи
   * зависимости — все зарегистрированные члены семейства, а значение —
   * замороженный массив их экземпляров.
   *
   * Разрешён в `deps` любого провайдера. Токен зарезервирован: провайдер,
   * зарегистрированный под ним вручную, — ошибка регистрации.
   */
  readonly all: FamilyAllToken<T>;
}

/** Все созданные семейства; по этому набору работает `isTokenFamily`. */
const families = new WeakSet<object>();

/**
 * Создаёт семейство токенов.
 *
 * Результат — функция: `Family(param)` возвращает токен члена с `id`
 * вида `"<name>:<param>"`. Вызовы мемоизированы: один и тот же параметр
 * всегда даёт тот же токен — это часть обещания семейства, а не
 * оптимизация. Без мемоизации каждое обращение заводило бы новый узел
 * графа под тем же именем.
 *
 * Членство читается полем `family` токена. Похожий токен, собранный
 * вручную через `makeToken('Name:param')`, — другой, не связанный с
 * семейством токен.
 *
 * @template T - Тип значения каждого члена
 * @template Params - Параметры члена; в V1 ровно один строковый параметр
 * @param name - Имя семейства
 * @returns Семейство токенов
 *
 * @example
 * ```typescript
 * const ILogger = makeTokenFamily<ILoggerService, [scope: string]>('Logger');
 *
 * @Injectable([ILogger('users')])
 * class UserService {
 *   constructor(private logger: ILoggerService) {}
 * }
 * ```
 */
export const makeTokenFamily = <
  T,
  Params extends [param: string] = [param: string],
>(
  name: string,
): TokenFamily<T, Params> => {
  const members = new Map<string, FamilyMemberToken<T>>();

  const family = (...params: Params): FamilyMemberToken<T> => {
    const [param] = params;

    const memoized = members.get(param);
    if (memoized) {
      return memoized;
    }

    // Токен не заморожен: пакет, объявивший семейство, дописывает на своего
    // члена собственный хэндл — так `@nestling/config` вешает на токен
    // секции её набор ключей. Идентичность от этого не страдает: она
    // ссылочная, а не структурная.
    const token = {
      id: `${name}:${param}`,
      family: family as TokenFamily<T, any>,
      param,
    } as FamilyMemberToken<T>;

    members.set(param, token);

    return token;
  };

  const autoToken = Object.freeze({
    id: `${name}.auto`,
    autoOf: family as TokenFamily<T, any>,
  }) as FamilyAutoToken<T>;

  const allToken = Object.freeze({
    id: `${name}.all`,
    allOf: family as TokenFamily<T, any>,
  }) as FamilyAllToken<T>;

  Object.defineProperties(family, {
    familyName: { value: name, enumerable: true },
    auto: { value: autoToken, enumerable: true },
    all: { value: allToken, enumerable: true },
  });

  families.add(family);

  return family as TokenFamily<T, Params>;
};

/**
 * Проверяет, что значение — семейство токенов, а не токен и не класс.
 *
 * @param value - Проверяемое значение
 * @returns `true`, если значение создано {@link makeTokenFamily}
 */
export const isTokenFamily = (value: unknown): value is TokenFamily<any, any> =>
  typeof value === 'function' && families.has(value);

/**
 * Возвращает члена семейства, если токен им является.
 *
 * Принадлежность читается полем, поэтому вопрос «чей это токен» не
 * зависит от того, как выглядит его `id`.
 *
 * @param token - Токен
 * @returns Тот же токен как член семейства либо `undefined`
 */
export const asFamilyMember = (
  token: InjectionToken,
): FamilyMemberToken<any> | undefined =>
  typeof token === 'object' &&
  token !== null &&
  isTokenFamily((token as FamilyMemberToken).family)
    ? (token as FamilyMemberToken<any>)
    : undefined;

/**
 * Возвращает семейство, которому принадлежит токен-член.
 *
 * @param token - Токен
 * @returns Семейство либо `undefined`, если токен членом не является
 */
export const familyOf = (
  token: InjectionToken,
): TokenFamily<any, any> | undefined => asFamilyMember(token)?.family;

/**
 * Возвращает семейство, которому принадлежит токен `.auto`, если токен —
 * такой заместитель.
 *
 * @internal
 */
export const getAutoSentinelFamily = (
  token: InjectionToken,
): TokenFamily<any, any> | undefined =>
  typeof token === 'object' &&
  token !== null &&
  isTokenFamily((token as FamilyAutoToken).autoOf)
    ? (token as FamilyAutoToken).autoOf
    : undefined;

/**
 * Возвращает семейство, которому принадлежит токен `.all`, если токен —
 * такой заместитель.
 *
 * Билдер использует это и чтобы решить, какие агрегаты создавать, и чтобы
 * отклонить провайдер, зарегистрированный вручную под зарезервированным
 * токеном.
 *
 * @internal
 */
export const getAllSentinelFamily = (
  token: InjectionToken,
): TokenFamily<any, any> | undefined =>
  typeof token === 'object' &&
  token !== null &&
  isTokenFamily((token as FamilyAllToken).allOf)
    ? (token as FamilyAllToken).allOf
    : undefined;

/**
 * Заменяет токен `.auto` на члена, названного по классу-потребителю.
 *
 * Вызывается декоратором `@Injectable` в момент декорирования: потребитель
 * известен статически, в рантайме ничего не вычисляется.
 *
 * @internal
 */
export const resolveAutoDependency = <T>(
  dep: InjectionToken<T>,
  consumer: Constructor,
): InjectionToken<T> => {
  const family = getAutoSentinelFamily(dep);
  if (!family) {
    return dep;
  }

  const consumerName = consumer.name;
  if (!consumerName) {
    throw new Error(
      `Cannot resolve '${family.familyName}.auto': the decorated class has no name. Use an explicit '${family.familyName}('<name>')' member token instead`,
    );
  }

  return family(consumerName) as InjectionToken<T>;
};
