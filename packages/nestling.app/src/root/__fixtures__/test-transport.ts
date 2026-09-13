/**
 * Транспорт-фейк для спеков композиционного корня: DI-токен экземпляра,
 * конструктор декларации и наборы способностей.
 *
 * Спеки этого пакета проверяют сборку приложения, а не работу конкретного
 * транспорта: им нужна декларация, привязанная к DI-токену, и транспорт,
 * который эту декларацию получит. Настоящий HTTP или CLI дал бы то же
 * самое ценой зависимости на пакет, который сам зависит от `@nestlingjs/app`.
 */

import type {
  AnyFail,
  AnyFailDefinition,
  AnyInput,
  AnyOutput,
  AnyPayload,
  EndpointDefinition,
  EndpointOptions,
  FailsOf,
  HandlerClass,
  HandlerFn,
  SuccessStatus,
  TransportCapabilities,
} from '../../pipeline/index.js';
import { makeEndpoint } from '../../pipeline/index.js';
import type { ITransport } from '../../transport/index.js';
import { DEFAULT_INSTANCE } from '../../transport/index.js';

import type { TokenFamily } from '@nestlingjs/container';
import { makeTokenFamily } from '@nestlingjs/container';

/**
 * Семейство DI-токенов транспорта-фейка: один DI-токен на экземпляр.
 *
 * Устроено как у настоящего транспорта: короткое имя выводится из id
 * (`transport:test` → `'test'`), экземпляр по умолчанию называется как вид.
 */
export const TestTransport$: TokenFamily<ITransport, [instance: string]> =
  makeTokenFamily<ITransport, [instance: string]>('transport:test');

/** Способности транспорта, который умеет только value-формы */
export const VALUE_ONLY: TransportCapabilities = {
  input: new Set(['value']),
  output: new Set(['value']),
};

/** Способности транспорта, который умеет все формы io */
export const ALL_FORMS: TransportCapabilities = {
  input: new Set(['value', 'stream', 'events', 'multipart']),
  output: new Set(['value', 'stream', 'events']),
};

/**
 * Поля декларации для `testEndpoint`: всё, что принимает `makeEndpoint`,
 * кроме DI-токена и паттерна — их конструктор проставляет сам.
 */
type TestEndpointDictionary<
  I extends AnyPayload,
  O extends AnyOutput,
  P extends AnyInput,
  PN,
  E extends readonly AnyFailDefinition[],
  PF extends AnyFail,
  S extends SuccessStatus,
> = Omit<EndpointOptions<I, O, P, PN, E, PF, S>, 'pattern' | 'transport'> & {
  /** Метод: вместе с путём складывается в паттерн `'GET /users'` */
  method: string;

  /** Путь: вместе с методом складывается в паттерн */
  path: string;

  /** Имя экземпляра транспорта; без него — экземпляр по умолчанию */
  on?: string;
};

/**
 * Строит декларацию endpoint'а на транспорте-фейке.
 *
 * Повторяет то, что делает конструктор настоящего транспорта: складывает
 * паттерн из своих полей и ссылается на транспорт DI-токеном, а не строкой.
 *
 * @example
 * ```typescript
 * const Ping = testEndpoint({
 *   method: 'GET',
 *   path: '/ping',
 *   handler: async () => new Ok({ pong: true }),
 * });
 * ```
 */
export function testEndpoint<
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = undefined,
  P extends AnyInput = AnyInput,
  PN = never,
  E extends readonly AnyFailDefinition[] = [],
  PF extends AnyFail = never,
  S extends SuccessStatus = never,
>(
  declaration: TestEndpointDictionary<I, O, P, PN, E, PF, S> & {
    handler: HandlerFn<I, O, P, FailsOf<E> | NoInfer<PF>, S>;
  },
): EndpointDefinition<I, O, P, PN>;
export function testEndpoint<
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = undefined,
  P extends AnyInput = AnyInput,
  PN = never,
  E extends readonly AnyFailDefinition[] = [],
  PF extends AnyFail = never,
  S extends SuccessStatus = never,
  C extends HandlerClass<I, O, P, FailsOf<E> | NoInfer<PF>, S> = HandlerClass<
    I,
    O,
    P,
    FailsOf<E> | NoInfer<PF>,
    S
  >,
>(
  declaration: TestEndpointDictionary<I, O, P, PN, E, PF, S> & {
    handler: C;
  },
): EndpointDefinition<I, O, P, PN | C>;
export function testEndpoint(
  declaration: TestEndpointDictionary<
    any,
    any,
    any,
    unknown,
    readonly AnyFailDefinition[],
    AnyFail,
    SuccessStatus
  > & {
    handler: unknown;
  },
): EndpointDefinition<any, any, any, unknown> {
  const { method, path, on, ...rest } = declaration;

  return (makeEndpoint as (options: unknown) => EndpointDefinition)({
    ...rest,
    transport: TestTransport$(on ?? DEFAULT_INSTANCE),
    pattern: `${method} ${path}`,
  });
}
