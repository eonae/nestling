/**
 * Конструктор CLI-деклараций и чтение политики биндинга с проекции.
 */

import { CliTransport$ } from './token.js';

import type {
  AnyEndpointDefinition,
  AnyFail,
  AnyFailDefinition,
  AnyHandlerResult,
  AnyInput,
  AnyOutput,
  AnyPayload,
  CheckedHandlerFn,
  EndpointDefinition,
  FailsOf,
  HandlerClass,
  Pipeline,
  ValidateOutputForm,
} from '@nestlingjs/app';
import { DEFAULT_INSTANCE, makeEndpoint } from '@nestlingjs/app';
import type {
  HandlerResultOf,
  ValidateHandlerFails,
} from '@nestlingjs/operations';

/**
 * Что делает команда с недостающим обязательным полем входа.
 *
 * - `'error'` (умолчание) — собранный из argv payload идёт в валидацию, и
 *   отсутствие поля даёт отказ `bad_request` с путём поля;
 * - `'prompt'` — транспорт спрашивает недостающие поля в терминале и
 *   выполняет команду с достроенным входом.
 *
 * Политик две, и умолчание названо значением: в декларации оно читается
 * выбором, а не умолчанием, о котором надо помнить.
 */
export type CliMissingPolicy = 'error' | 'prompt';

/**
 * Политика биндинга команды — то, что едет полем `binding` декларации.
 *
 * Ядро поле переносит и не читает: так же через него едет bind-карта HTTP.
 */
export interface CliBinding {
  /** Стратегия сбора недостающего обязательного поля входа */
  readonly missing: CliMissingPolicy;
}

/**
 * Транспортный словарь CLI-декларации.
 *
 * Легален и типизирован только здесь; пайплайн и хендлер остаются
 * транспорт-слепыми.
 */
export interface CliEndpointDictionary<
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
  P extends AnyInput = AnyInput,
  PN = never,
  E extends readonly AnyFailDefinition[] = [],
  PF extends AnyFail = never,
> {
  /** Форма io для input: значение или `stream(...)` */
  input?: I;

  /** Форма io для output (см. `ValidateOutputForm`) */
  output?: O & ValidateOutputForm<O>;

  /**
   * Объявленные отказы команды. Транспорт поле не интерпретирует — только
   * пробрасывает в `makeEndpoint` (см. `httpEndpoint`).
   */
  errors?: E;

  /**
   * Pipeline для этой команды. Классы-юниты допустимы: они попадают в
   * `TNeeds` декларации и гасятся вместе с зависимостями хендлера.
   *
   * Отказы, объявленные слоями пайплайна, входят в эффективное множество
   * команды: перечислять их в `errors:` не нужно.
   */
  pipeline?: Pipeline<AnyInput, P, PN, PF>;

  /**
   * Что делать с недостающим обязательным полем входа; по умолчанию
   * `'error'`.
   *
   * `'prompt'` требует конвертера схем в `cli({ converters })`: вопрос
   * выводится из JSON Schema формы `input`, а Standard Schema интроспекции
   * не даёт. Команда с формой входа `stream(...)` политику не принимает:
   * вопросы и поток читают один `stdin`.
   */
  missing?: CliMissingPolicy;

  /**
   * Причина вывода команды из-под инвариантов сборки. Транспорт поле не
   * интерпретирует — только пробрасывает в `makeEndpoint` (см.
   * `httpEndpoint`).
   */
  detached?: string;

  /** Имя экземпляра транспорта, обслуживающего команду; по умолчанию `'default'` */
  on?: string;
}

/**
 * Конструктор CLI-деклараций: имя команды первым аргументом, словарь
 * транспорта вторым.
 *
 * Тонкая надстройка над kernel-примитивом `makeEndpoint`: `transport` —
 * `'cli'`, `pattern` — имя команды. Общий механизм деклараций (обе формы
 * `handler`, `resolve`, бренд) живёт в `makeEndpoint`.
 *
 * Адрес стоит там же, где у HTTP-конструктора, — первым аргументом.
 * Статиков по методу у CLI нет: у команды нет глагола, который делил бы
 * её адрес на две части.
 *
 * @param command - Имя команды; оно же паттерн endpoint'а
 * @param declaration - Словарь команды: формы io, пайплайн, хендлер
 *
 * @example
 * ```typescript
 * export const Deploy = cliEndpoint('deploy', {
 *   input: z.object({ env: z.enum(['dev', 'prod']) }),
 *   output: DeployResult,
 *   missing: 'prompt',
 *   pipeline: makePipeline(),
 *   handler: async ({ env }) => deploy(env),
 * });
 * ```
 *
 * @throws {Error} Пустое имя команды или неизвестная политика `missing`
 */
export function cliEndpoint<
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
  P extends AnyInput = AnyInput,
  PN = never,
  E extends readonly AnyFailDefinition[] = [],
  PF extends AnyFail = never,
  R extends AnyHandlerResult<O> = AnyHandlerResult<O>,
>(
  command: string,
  declaration: CliEndpointDictionary<I, O, P, PN, E, PF> & {
    handler: CheckedHandlerFn<I, P, FailsOf<E> | NoInfer<PF>, R>;
  },
): EndpointDefinition<I, O, P, PN>;
export function cliEndpoint<
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
  P extends AnyInput = AnyInput,
  PN = never,
  E extends readonly AnyFailDefinition[] = [],
  PF extends AnyFail = never,
  C extends HandlerClass<I, O, P, AnyFail> = HandlerClass<I, O, P, AnyFail>,
>(
  command: string,
  declaration: CliEndpointDictionary<I, O, P, PN, E, PF> & {
    handler: C &
      ValidateHandlerFails<HandlerResultOf<C>, FailsOf<E> | NoInfer<PF>>;
  },
): EndpointDefinition<I, O, P, PN | C>;
export function cliEndpoint(
  command: string,
  declaration: CliEndpointDictionary<
    any,
    any,
    any,
    unknown,
    readonly AnyFailDefinition[],
    AnyFail
  > & {
    handler: unknown;
  },
): AnyEndpointDefinition {
  const { on, missing = 'error', ...rest } = declaration;

  if (typeof command !== 'string' || command.length === 0) {
    throw new Error(
      "cliEndpoint('<command>', { … }): the command name must be a non-empty string.",
    );
  }

  if (missing !== 'error' && missing !== 'prompt') {
    throw new Error(
      `cliEndpoint('${command}', { … }): 'missing' must be 'error' or ` +
        `'prompt', got ${JSON.stringify(missing)}.`,
    );
  }

  return (makeEndpoint as (options: unknown) => AnyEndpointDefinition)({
    ...rest,
    transport: CliTransport$(on ?? DEFAULT_INSTANCE),
    pattern: command,
    // Умолчание поля не добавляет: декларация без политики остаётся тем
    // же значением, каким была до появления `missing`
    ...(missing === 'prompt'
      ? { binding: { missing } satisfies CliBinding }
      : {}),
  });
}

/**
 * Носитель политики: декларация или её проекция для транспорта.
 *
 * Транспорт читает политику с `RouteDeclaration`, автор декларации — с
 * самой декларации; обоим нужно одно поле.
 */
export interface CliBindingBearer {
  readonly binding?: unknown;
}

/**
 * Читает политику биндинга с декларации или её проекции.
 *
 * Декларация без политики несёт `binding: undefined`; тогда действует
 * умолчание `'error'` — то же поведение, что было до появления поля.
 */
export function cliBindingOf(bearer: CliBindingBearer): CliBinding {
  const carried: unknown = bearer.binding;

  const missing =
    typeof carried === 'object' && carried !== null && 'missing' in carried
      ? (carried as { readonly missing: unknown }).missing
      : undefined;

  return { missing: missing === 'prompt' ? 'prompt' : 'error' };
}
