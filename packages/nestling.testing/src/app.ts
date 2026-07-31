/**
 * `assembleTest` — тестовый composition root и `TestApp` вокруг него.
 *
 * Собственного фазового рантайма здесь нет: пакет заводит **тот же** `App`
 * через шов `@nestling/app/testing` и останавливает его после фазы 3 WIRE.
 * Второй рантайм рядом с первым разъехался бы на первом же change'е.
 */

import type { TestConfig } from './config.js';
import { toBindings } from './config.js';
import type { TestOverride, ValidatedOverrides } from './overrides.js';
import { splitOverrides } from './overrides.js';

import type { Feature } from '@nestling/app';
import type { WiredApp, WiredEndpoint } from '@nestling/app/testing';
import { wireApp } from '@nestling/app/testing';
import type { InjectionToken, Module, Provider } from '@nestling/container';
import { valueProvider } from '@nestling/container';
import type {
  AnyEndpointDefinition,
  AnyInput,
  AnyOutput,
  AnyPayload,
  EndpointDefinition,
  EndpointMeta,
  ExtendableContext,
  InferInput,
  InferOutput,
  Raw,
  ResponseContext,
} from '@nestling/pipeline';
import { makeEmptyContext, transportNameOf } from '@nestling/pipeline';
import type { DispatchOptions, ITransport } from '@nestling/transport';

/**
 * Свойства границы для одного `call`.
 *
 * `exposeErrorDetails` по умолчанию включён: в тесте детали отказа нужны
 * всегда, а прод-политика «не раскрывать» проверяется на своём уровне.
 */
export interface TestCallOptions extends DispatchOptions {
  /**
   * Транспортные атрибуты кадра запроса (заголовки, флаги CLI).
   *
   * По умолчанию пусты: in-proc вызов честен, но пуст — слой, читающий
   * HTTP-заголовки, в app-тесте не увидит ничего, и это цена вызова без
   * провода, а не дефект.
   */
  attributes?: Record<string, unknown>;
}

/** Пара «токен → значение» для поставки недостающего провайдера */
export type TestStub = readonly [token: InjectionToken<any>, value: any];

/**
 * Словарь тестовой сборки: боевой плюс `overrides` и `stubs`.
 *
 * @template L - Список подстановок; выводится из литерала, чтобы каждая
 * пара проверялась по типу своего токена
 */
export interface TestAssemblySpec<
  L extends readonly unknown[] = readonly TestOverride[],
> {
  /** Модули корня */
  modules?: readonly Module[];

  /** Провайдеры корня */
  providers?: readonly Provider[];

  /** Фичи приложения; подмножество выбирается полем `select` */
  features?: readonly Feature[];

  /** Выбор фич — тот же, что в бою: опечатка падает на фазе 0 */
  select?: string | readonly string[];

  /**
   * Транспорты — перечисляются так же, как в проде.
   *
   * Автоподстановки нет: ручка на транспорте, которого нет в графе, —
   * тот же fail-fast ASSEMBLE, что и в бою. Сокет всё равно не откроется,
   * потому что START не выполняется.
   */
  transports?: readonly Provider<ITransport>[];

  /** Конфиг: источник, одна привязка или их список */
  config?: TestConfig;

  /**
   * Подстановки: пары «токен → фейк» и подмены рецептов семейств.
   *
   * Ключ существует **только** у тестового корня. Право override
   * позиционное: подменяется тот токен, ссылка на который есть у теста;
   * строковой формы (`overrideByName('…')`) не существует.
   */
  overrides?: L;

  /**
   * Поставка недостающего: пары «токен → значение», регистрируемые
   * обычными провайдерами.
   *
   * Форма выбрана совместимой с будущим `stub(Contract, impl)` — он
   * приедет элементом того же списка.
   */
  stubs?: readonly TestStub[];
}

/**
 * Приложение, остановленное после WIRE.
 *
 * `dispatch` рождён, `@OnInit` выполнены. Не выполняются: `@OnStart`,
 * `serve`, обработчики сигналов процесса и печать состава сборки. Ресурс,
 * захваченный в `@OnStart`, в app-тесте не захватывается — это не баг, а
 * цена фазовой модели: `@OnStart` есть хук go-live, а тестовый прогон в
 * эфир не выходит.
 */
export class TestApp {
  readonly #wired: WiredApp;

  /** @internal конструируется только `assembleTest`/`testModule` */
  constructor(wired: WiredApp) {
    this.#wired = wired;
  }

  /**
   * Id узлов, выпавших прунингом осиротевших поддеревьев.
   *
   * «Почему мой `@OnInit` не выполнился» отвечается данными, а не чтением
   * исходников.
   */
  get pruned(): readonly string[] {
    return this.#wired.container.pruned;
  }

  /** Имена выбранных фич — включая приехавшие по `dependsOn` */
  get features(): readonly string[] {
    return this.#wired.features.map((feature) => feature.name);
  }

  /**
   * Инстанс узла графа или `null`, если узла нет (не зарегистрирован либо
   * выпал прунингом — второе видно в {@link pruned}).
   */
  get<T>(token: InjectionToken<T>): T | null {
    return this.#wired.container.get(token);
  }

  /**
   * Исполняет ручку in-proc — через **полный пайплайн**.
   *
   * Этим app-тест и отличается от юнита: отрабатывают все слои, валидация
   * схем и страж границы, а результат — `ResponseContext`, то есть ровно
   * то, что увидел бы транспорт.
   *
   * Декларация ищется по **идентичности значения**: у теста на руках то же
   * значение, что в `endpoints:` модуля, и совпадение строк тут не нужно.
   *
   * Транспортный биндинг не выполняется: `call` принимает уже готовый
   * payload, а не запрос. Раскладка path/query/body по bind-карте — предмет
   * e2e и юнит-тестов bind-карты.
   *
   * @param endpoint - Декларация из `endpoints:` модуля
   * @returns Ответ границы: успех со значением по `output`-схеме либо отказ
   * со `status` и `code` из закрытого контракта `errors:`
   * @throws {Error} Если декларации нет в собранном приложении
   *
   * @example
   * ```typescript
   * const res = await app.call(CreateUser, { name: 'Alice' });
   * expect(unwrap(res)).toEqual({ id: '1', name: 'Alice' });
   * ```
   */
  async call<I extends AnyPayload, O extends AnyOutput>(
    endpoint: EndpointDefinition<I, O, any, any>,
    ...args: CallArgs<I>
  ): Promise<ResponseContext<InferOutput<O>>> {
    const [input, options = {}] = args;

    const wired = this.#requireEndpoint(endpoint as AnyEndpointDefinition);
    const { executable } = wired;

    const raw: Raw = {
      transport: transportNameOf(executable.transport),
      pattern: executable.pattern,
      payload: input,
      attributes: options.attributes ?? {},
    };

    const meta: EndpointMeta = {
      transport: raw.transport,
      pattern: executable.pattern,
      input: executable.input,
      output: executable.output,
      // Объявленные отказы доезжают до стража только так: декларация →
      // кадр запроса → контекст, без глобального реестра
      errors: executable.errors,
    };

    const ctx = makeEmptyContext(
      raw,
      meta,
      this.#wired.signal,
    ) as ExtendableContext<AnyInput>;

    const response = await wired.dispatch.call(executable.pattern, ctx, {
      exposeErrorDetails: options.exposeErrorDetails ?? true,
      onUnknownFail: options.onUnknownFail,
    });

    return response as ResponseContext<InferOutput<O>>;
  }

  /**
   * SHUTDOWN тестового прогона: взвод общего сигнала, затем `@OnDestroy`
   * в реверсе топосорта. Идемпотентен.
   */
  async close(): Promise<void> {
    await this.#wired.close();
  }

  /** `await using app = await assembleTest({ … })` */
  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  /** Ручка приложения или ошибка с перечнем доступных */
  #requireEndpoint(endpoint: AnyEndpointDefinition): WiredEndpoint {
    const wired = this.#wired.endpoints.get(endpoint);

    if (wired) {
      return wired;
    }

    const available = [...this.#wired.endpoints.values()]
      .map((known) => `${known.executable.pattern} (${known.moduleName})`)
      .join(', ');

    throw new Error(
      `Endpoint '${String(endpoint?.pattern)}' is not part of the assembled ` +
        `application: it is declared by a module that was not registered, or ` +
        `by a feature that 'select' left out. Available handles: ` +
        `${available || '(none)'}.`,
    );
  }
}

/**
 * Аргументы `call` после декларации.
 *
 * Ручка без `input`-формы вызывается одним аргументом; ручка со схемой
 * обязана получить payload — иначе это ошибка компиляции, а не отказ
 * валидации в рантайме.
 */
type CallArgs<I extends AnyPayload> =
  undefined extends InferInput<I>
    ? [input?: InferInput<I>, options?: TestCallOptions]
    : [input: InferInput<I>, options?: TestCallOptions];

/**
 * Собирает тестовое приложение и останавливает его после фазы 3 WIRE.
 *
 * Тот же словарь сборки, что у `assemble`, плюс `overrides` и `stubs`; те
 * же fail-fast'ы ASSEMBLE — сверка требуемых транспортов, формы io против
 * способностей транспорта, ацикличность графа.
 *
 * @param spec - Словарь сборки с подстановками
 * @returns Приложение с `call`/`get`/`pruned`/`close`
 *
 * @example
 * ```typescript
 * await using app = await assembleTest({
 *   features: [UsersFeature],
 *   transports: [http()],
 *   overrides: [
 *     [UsersRepository, inMemoryUsersRepo()],
 *     familyOverride(ILogger, () => noopLogger),
 *   ],
 *   config: vars({ USERS_PAGE_SIZE: '10' }),
 * });
 * ```
 */
export async function assembleTest<const L extends readonly TestOverride[]>(
  spec: TestAssemblySpec<L> & { overrides?: ValidatedOverrides<L> } = {},
): Promise<TestApp> {
  const { tokens, families } = splitOverrides(
    spec.overrides as readonly TestOverride[] | undefined,
  );

  const wired = await wireApp({
    modules: spec.modules,
    providers: [
      ...(spec.providers ?? []),
      // Стаб — поставка недостающего, а не подмена: обычный провайдер
      ...(spec.stubs ?? []).map(([token, value]) =>
        valueProvider(token, value),
      ),
    ],
    features: spec.features,
    select: spec.select,
    transports: spec.transports,
    config: toBindings(spec.config),
    overrides: tokens,
    familyOverrides: families,
  });

  return new TestApp(wired);
}
