import type { Constructor, InjectionToken, TokenString } from '../common';

/**
 * A family of injection tokens - one recipe, many members addressed by a parameter.
 *
 * Calling the family returns an ordinary memoized {@link TokenString}, so a member
 * is usable everywhere a token is: `@Injectable` deps, factory provider deps,
 * `container.get()`. Members are materialized at build time (see `familyProvider`),
 * never resolved at runtime.
 *
 * @template T - The type provided by every member of the family
 * @template Params - Member parameters; v1 supports exactly one string parameter
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
  /** Returns the memoized member token for the given parameter. */
  (...params: Params): TokenString<T>;
  /** Family name - the prefix of every member token id. */
  readonly familyName: string;
  /**
   * Consumer-aware sentinel. `@Injectable([Family.auto])` records
   * `Family('<DecoratedClassName>')` in the class metadata.
   *
   * Only valid in deps of a class decorated with `@Injectable`.
   */
  readonly auto: TokenString<T>;
}

/**
 * A registered family member: which family it belongs to and with which parameter.
 *
 * @internal
 */
export interface FamilyMemberRef {
  /** Name of the family that created the member token */
  familyName: string;
  /** The parameter the member was created with */
  param: string;
}

/**
 * The parameter reserved for the `.auto` sentinel.
 *
 * @internal
 */
const AUTO_PARAM = '{auto}';

/** All family values ever created - the identity check behind `isTokenFamily`. */
const families = new WeakSet<object>();

/** Family names, used to suggest a family for a look-alike token id. */
const familyNames = new Set<string>();

/** Member token id -> family + parameter. Formalizes the hand-rolled registry pattern. */
const memberIndex = new Map<string, FamilyMemberRef>();

/** `.auto` sentinel token id -> the family that owns it. */
const sentinelIndex = new Map<string, TokenFamily<any, any>>();

/**
 * Creates a family of injection tokens.
 *
 * The returned value is a function: `Family(param)` produces the member token
 * `"<name>:<param>"`. Calls are memoized - the same parameter always yields the
 * same token and a single entry in the family's member registry.
 *
 * Members are ordinary tokens, but they are only recognized as family members
 * when created through the family. A look-alike token built with
 * `makeToken('Name:param')` is a different, unrelated token.
 *
 * @template T - The type provided by every member
 * @template Params - Member parameters; v1 supports exactly one string parameter
 * @param name - Family name; must not contain the member separator semantics you rely on
 * @returns The token family
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

  const family = (...params: Params): TokenString<T> => {
    const [param] = params;

    if (param === AUTO_PARAM) {
      throw new Error(
        `Parameter '${AUTO_PARAM}' is reserved for '${name}.auto' and cannot be used as a member parameter of family '${name}'`,
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
  });

  families.add(family);
  familyNames.add(name);
  sentinelIndex.set(autoSentinel, family as TokenFamily<any, any>);

  return family as TokenFamily<T, Params>;
};

/**
 * Type guard: is the value a token family (as opposed to a token or a class)?
 *
 * @param value - The value to check
 * @returns true if the value was produced by {@link makeTokenFamily}
 */
export const isTokenFamily = (value: unknown): value is TokenFamily<any, any> =>
  typeof value === 'function' && families.has(value);

/**
 * Looks up the family membership of a token id.
 *
 * Membership comes from the family's own registry, not from parsing the id -
 * a token that merely looks like a member is not one.
 *
 * @internal
 */
export const lookupFamilyMember = (
  tokenId: string,
): FamilyMemberRef | undefined => memberIndex.get(tokenId);

/**
 * Returns the family owning the `.auto` sentinel, if the token is a sentinel.
 *
 * @internal
 */
export const getAutoSentinelFamily = (
  token: InjectionToken,
): TokenFamily<any, any> | undefined =>
  typeof token === 'string' ? sentinelIndex.get(token) : undefined;

/**
 * Suggests a family for a token id that looks like a member but is not one
 * (typically a look-alike built with `makeToken`).
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
 * Resolves a `.auto` sentinel to the member named after the consumer class.
 *
 * Called by `@Injectable` at decoration time - the consumer is known statically,
 * so no runtime resolution is involved.
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
