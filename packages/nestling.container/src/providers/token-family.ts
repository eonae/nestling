import type { Constructor, InjectionToken, TokenString } from '../common';

/**
 * Семейство токенов: один рецепт, много членов, различаемых параметром.
 *
 * Вызов семейства возвращает обычный мемоизированный {@link TokenString},
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
 * ILogger('users'); // TokenString<ILoggerService> with id 'Logger:users'
 * ```
 */
export interface TokenFamily<
  T = unknown,
  Params extends [param: string] = [param: string],
> {
  /** Возвращает мемоизированный токен члена для параметра. */
  (...params: Params): TokenString<T>;
  /** Имя семейства — префикс идентификатора каждого члена. */
  readonly familyName: string;
  /**
   * Токен-заместитель «член по имени потребителя».
   * `@Injectable([Family.auto])` записывает в метаданные класса
   * `Family('<ИмяКласса>')`.
   *
   * Разрешён только в `deps` класса с декоратором `@Injectable`.
   */
  readonly auto: TokenString<T>;
  /**
   * Токен-заместитель агрегата: все члены семейства одним массивом.
   * Зависимость от `Family.all` заставляет `build()` создать узел, чьи
   * зависимости — все зарегистрированные члены семейства, а значение —
   * замороженный массив их экземпляров.
   *
   * Разрешён в `deps` любого провайдера. Токен зарезервирован: провайдер,
   * зарегистрированный под ним вручную, — ошибка регистрации.
   */
  readonly all: TokenString<readonly T[]>;
}

/**
 * Зарегистрированный член семейства: какому семейству принадлежит и с каким
 * параметром создан.
 *
 * @internal
 */
export interface FamilyMemberRef {
  /** Имя семейства, создавшего токен члена */
  familyName: string;
  /** Параметр, с которым создан член */
  param: string;
}

/**
 * Параметр, зарезервированный за токеном `.auto`.
 *
 * @internal
 */
const AUTO_PARAM = '{auto}';

/**
 * Параметр, зарезервированный за токеном агрегата `.all`.
 *
 * @internal
 */
const ALL_PARAM = '{all}';

/** Все созданные семейства; по этому набору работает `isTokenFamily`. */
const families = new WeakSet<object>();

/** Имена семейств: подсказка для токена, похожего на члена семейства. */
const familyNames = new Set<string>();

/** Идентификатор токена члена и его семейство с параметром. */
const memberIndex = new Map<string, FamilyMemberRef>();

/** Идентификатор токена `.auto` и семейство, которому он принадлежит. */
const sentinelIndex = new Map<string, TokenFamily<any, any>>();

/**
 * Идентификатор токена `.all` и семейство, которому он принадлежит.
 *
 * Хранится отдельно от `memberIndex` намеренно: агрегат — не член, и запись
 * `{all}` в реестре членов заставила бы создание членов отдать его рецепту.
 */
const allSentinelIndex = new Map<string, TokenFamily<any, any>>();

/**
 * Создаёт семейство токенов.
 *
 * Результат — функция: `Family(param)` возвращает токен члена
 * `"<name>:<param>"`. Вызовы мемоизированы: один и тот же параметр всегда
 * даёт тот же токен и одну запись в реестре членов семейства.
 *
 * Члены — обычные токены, но членами семейства считаются только созданные
 * через семейство. Похожий токен, собранный вручную через
 * `makeToken('Name:param')`, — другой, не связанный с семейством токен.
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
  const members = new Map<string, TokenString<T>>();
  const autoSentinel = `${name}:${AUTO_PARAM}`;
  const allSentinel = `${name}:${ALL_PARAM}`;

  const family = (...params: Params): TokenString<T> => {
    const [param] = params;

    if (param === AUTO_PARAM) {
      throw new Error(
        `Parameter '${AUTO_PARAM}' is reserved for '${name}.auto' and cannot be used as a member parameter of family '${name}'`,
      );
    }

    if (param === ALL_PARAM) {
      throw new Error(
        `Parameter '${ALL_PARAM}' is reserved for '${name}.all' and cannot be used as a member parameter of family '${name}'`,
      );
    }

    const memoized = members.get(param);
    if (memoized) {
      return memoized;
    }

    const token = `${name}:${param}` as TokenString<T>;
    members.set(param, token);
    memberIndex.set(token, { familyName: name, param });

    return token;
  };

  Object.defineProperties(family, {
    familyName: { value: name, enumerable: true },
    auto: { value: autoSentinel as TokenString<T>, enumerable: true },
    all: { value: allSentinel as TokenString<readonly T[]>, enumerable: true },
  });

  families.add(family);
  familyNames.add(name);
  sentinelIndex.set(autoSentinel, family as TokenFamily<any, any>);
  allSentinelIndex.set(allSentinel, family as TokenFamily<any, any>);

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
 * Находит семейство и параметр по идентификатору токена члена.
 *
 * Членство берётся из реестра семейства, а не из разбора идентификатора:
 * токен, лишь похожий на члена, членом не является.
 *
 * @internal
 */
export const lookupFamilyMember = (
  tokenId: string,
): FamilyMemberRef | undefined => memberIndex.get(tokenId);

/**
 * Возвращает семейство, которому принадлежит токен `.auto`, если токен —
 * такой заместитель.
 *
 * @internal
 */
export const getAutoSentinelFamily = (
  token: InjectionToken,
): TokenFamily<any, any> | undefined =>
  typeof token === 'string' ? sentinelIndex.get(token) : undefined;

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
  typeof token === 'string' ? allSentinelIndex.get(token) : undefined;

/**
 * Подбирает семейство для токена, который похож на члена, но членом не
 * является (обычно собран вручную через `makeToken`).
 *
 * @internal
 */
export const suggestFamilyForToken = (tokenId: string): string | undefined => {
  const separator = tokenId.indexOf(':');
  if (separator <= 0) {
    return undefined;
  }

  const prefix = tokenId.slice(0, separator);

  return familyNames.has(prefix) ? prefix : undefined;
};

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
