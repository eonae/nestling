/**
 * `assembleTest` — тестовый composition root и `TestApp` вокруг него.
 *
 * Собственного фазового рантайма здесь нет: пакет собирает **ту же**
 * декларацию `makeApp` через шов `@nestling/app/testing` и останавливает
 * приложение после фазы 3 WIRE. Второй рантайм рядом с первым разошёлся
 * бы с ним уже на первом change'е.
 */

import type { TestConfig } from './config.js';
import { toBindings } from './config.js';
import type { TestOverride, ValidatedOverrides } from './overrides.js';
import { splitOverrides } from './overrides.js';
import type { OperationStub } from './stub.js';
import { stubbedOperations } from './stub.js';

import type { App, FeatureSelection } from '@nestling/app';
import { isApp } from '@nestling/app';
import type { WiredApp, WiredEndpoint } from '@nestling/app/testing';
import { wireApp } from '@nestling/app/testing';
import type { InjectionToken } from '@nestling/container';
import { valueProvider } from '@nestling/container';
import type {
  CommandMeta,
  EmittingOperation,
  InvokeArgs,
} from '@nestling/operations';
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
import { busBindingOf, profileAttributes } from '@nestling/ports';
import type { DispatchOptions } from '@nestling/transport';

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
   * сети, а не дефект.
   */
  attributes?: Record<string, unknown>;
}

/**
 * Элемент списка `stubs:`: пара `токен → значение` либо стаб операции.
 *
 * Одно поле на обе формы, потому что решение у теста одно и то же —
 * «здесь боевого кода не будет»; стаб операции есть та же пара, только
 * токен в ней — член семейства вызывателей ([stub.ts](./stub.ts)).
 */
export type TestStub =
  | readonly [token: InjectionToken<any>, value: any]
  | OperationStub;

/**
 * Доставка `app.emit` одному подписчику.
 *
 * Ответ возвращается, а не проглатывается: боевой `emit` — fire-and-forget,
 * потому что издатель не отвечает за обработку, а тест отвечает ровно за
 * неё, и «доставлено, а обработалось ли — неизвестно» превращает проверку
 * подписчика в гонку.
 */
export interface EmitDelivery {
  /** Имя подписчика из биндинга; у `command` — имя операции */
  readonly subscriber: string;

  /** Ответ границы этого подписчика — то же, что вернул бы `app.call` */
  readonly response: ResponseContext;
}

/**
 * Опции тестовой сборки: выбор фич и подстановки.
 *
 * Состав приложения — фичи, плагины, провайдеры, транспорты, интерком,
 * политики — берётся из декларации `makeApp`; полей состава здесь нет.
 *
 * @template L - Список подстановок; выводится из литерала, чтобы каждая
 * пара проверялась по типу своего токена
 */
export interface TestAssemblyOptions<
  L extends readonly unknown[] = readonly TestOverride[],
> {
  /** Выбор фич — тот же, что в бою: опечатка падает на фазе ASSEMBLE */
  select?: FeatureSelection;

  /**
   * Конфиг теста: источник, одна привязка или их список.
   *
   * **Заменяет** привязку источников декларации целиком: тест изолирован
   * от источников приложения так же, как от `process.env`.
   */
  config?: TestConfig;

  /**
   * Подстановки: пары `токен → фейк` и подмены рецептов семейств.
   *
   * Ключ существует **только** у тестового корня. Право override
   * позиционное: подменяется тот токен, ссылка на который есть у теста;
   * строковой формы (`overrideByName('…')`) не существует.
   */
  overrides?: L;

  /**
   * Поставка недостающего: пары `токен → значение`, регистрируемые
   * обычными провайдерами.
   *
   * Той же формы стаб операции: `stub(Operation, impl)` возвращает пару
   * `токен вызывателя → фейк` и едет элементом этого же списка.
   */
  stubs?: readonly TestStub[];
}

/**
 * Приложение, остановленное после WIRE.
 *
 * `dispatch` создан, `@OnInit` выполнены. Не выполняются: `@OnStart`,
 * `serve`, обработчики сигналов процесса и печать состава сборки. Ресурс,
 * захваченный в `@OnStart`, в app-тесте не захватывается — это не баг, а
 * цена фазовой модели: `@OnStart` — хук фазы START, а тестовый прогон эту
 * фазу не проходит.
 */
export class TestApp {
  readonly #wired: WiredApp;

  readonly #stubbed: readonly string[];

  /** @internal конструируется только `assembleTest`/`testUnit` */
  constructor(wired: WiredApp, stubbed: readonly string[] = []) {
    this.#wired = wired;
    this.#stubbed = stubbed;
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

  /**
   * Имена операций, застабанных в этой сборке — по алфавиту.
   *
   * Отчёт — значение, а не печать (симметрично {@link pruned}): им сверяют
   * состав подстановок с матрицей `.check()`. Каждый застабанная операция
   * обязан быть опубликован хотя бы одной честной топологией, иначе стаб
   * прикрывает отсутствующую реализацию:
   *
   * ```typescript
   * const published = new Set(
   *   (await checkTopologies(spec, ['all', 'orders', 'quotas']))
   *     .flatMap(({ report }) => report.operations.map((c) => c.name)),
   * );
   *
   * expect(app.stubbed.filter((name) => !published.has(name))).toEqual([]);
   * ```
   */
  get stubbed(): readonly string[] {
    return this.#stubbed;
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
   * Исполняет endpoint in-proc — через **полный пайплайн**.
   *
   * Этим app-тест и отличается от юнита: отрабатывают все слои, валидация
   * схем и проверка границы, а результат — `ResponseContext`, то есть ровно
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
   * со `status` и `code` из закрытого перечня `errors:` операции
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
    const response = await this.#execute(wired, input, options);

    return response as ResponseContext<InferOutput<O>>;
  }

  /**
   * Доставляет факт или команду **всем** co-located подписчикам.
   *
   * Тест драйвит приложение снаружи внутрь — как издатель: находятся все
   * endpoint'ы, чей bus-биндинг несёт `subject`, равный имени операции, и
   * каждая гонится через **полный пайплайн** тем же кодом, что `call`.
   * Транспортные атрибуты кадра несут профиль вызова так же, как их несёт
   * боевой эмиттер, включая `idempotencyKey` у вида `command`.
   *
   * Через граф это сделать нельзя: `container.get(C.emitter)` вернул бы
   * вызыватель, только если его кто-то инжектит, а тест-драйвер по
   * определению внешний. Стаб эмиттера и `emit` поэтому ортогональны:
   * первый заменяет то, что приложение зовёт **наружу**, второй драйвит его
   * снаружи внутрь, и застабанный эмиттер доставке не мешает.
   *
   * Ждать здесь безопасно: сокета нет, подписчики co-located.
   *
   * @param operation - Операция вида `command` или `event`
   * @returns Ответы подписчиков с именем каждого, в порядке discovery
   * @throws {TypeError} Если операция — `request` (у неё нет подписчиков)
   * @throws {Error} Если у команды нет владельца в этой сборке. У события
   * ноль подписчиков допустимо: тогда список пуст
   *
   * @example
   * ```typescript
   * const [{ subscriber, response }] = await app.emit(PlaceOrder, {
   *   orderId: 'o-1',
   *   amount: 10,
   * });
   * ```
   */
  async emit<C extends EmittingOperation<any, any, any, any>>(
    operation: C,
    ...args: InvokeArgs<C>
  ): Promise<readonly EmitDelivery[]> {
    const [payload, meta] = args;

    assertEmitting(operation);

    const subscribers = this.#busEndpoints(operation.name);

    if (subscribers.length === 0) {
      if (operation.kind === 'event') {
        // Broadcast с нулём подписчиков — допустимое состояние
        return [];
      }

      throw new Error(
        `Operation '${operation.name}' (kind 'command') has no owner in the ` +
          `assembled application: no registered module declares ` +
          `implement(${operation.name}, { … }) — check that the feature ` +
          `owning it is part of 'select'. Available subjects: ` +
          `${this.#busSubjects().join(', ') || '(none)'}.`,
      );
    }

    const attributes = profileAttributes({
      subject: operation.name,
      deadline: meta?.deadline,
      ...(operation.kind === 'command'
        ? {
            idempotencyKey:
              (meta as CommandMeta | undefined)?.idempotencyKey ??
              crypto.randomUUID(),
          }
        : {}),
    });

    return await Promise.all(
      subscribers.map(async ({ wired, subscriber }) => ({
        subscriber,
        response: await this.#execute(wired, payload, { attributes }),
      })),
    );
  }

  /**
   * SHUTDOWN тестового прогона: взвод общего сигнала, затем `@OnDestroy`
   * в обратном топологическом порядке. Идемпотентен.
   */
  async close(): Promise<void> {
    await this.#wired.close();
  }

  /** `await using app = await assembleTest({ … })` */
  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  /**
   * Кадр запроса и его исполнение — одна процедура на `call` и `emit`.
   *
   * Второй сборки кадра не существует: `emit` отличается от `call` только
   * тем, откуда взялись endpoint и атрибуты, а не тем, как выглядит запрос.
   */
  async #execute(
    wired: WiredEndpoint,
    payload: unknown,
    options: TestCallOptions,
  ): Promise<ResponseContext> {
    const { executable } = wired;

    const raw: Raw = {
      transport: transportNameOf(executable.transport),
      pattern: executable.pattern,
      payload,
      attributes: options.attributes ?? {},
    };

    const meta: EndpointMeta = {
      transport: raw.transport,
      pattern: executable.pattern,
      input: executable.input,
      output: executable.output,
      // Объявленные отказы передаются проверке границы только так: из
      // декларации в кадр запроса и оттуда в контекст. Глобального реестра
      // ошибок нет
      errors: executable.errors,
    };

    const ctx = makeEmptyContext(
      raw,
      meta,
      this.#wired.signal,
    ) as ExtendableContext<AnyInput>;

    return await wired.dispatch.call(executable.pattern, ctx, {
      exposeErrorDetails: options.exposeErrorDetails ?? true,
      onUnknownFail: options.onUnknownFail,
    });
  }

  /** Endpoint'ы, подписанные на subject шины, с именем подписчика каждого */
  #busEndpoints(
    subject: string,
  ): { wired: WiredEndpoint; subscriber: string }[] {
    const found: { wired: WiredEndpoint; subscriber: string }[] = [];

    for (const wired of this.#wired.endpoints.values()) {
      const binding = busBindingOf(wired.declaration);

      if (binding?.subject === subject) {
        // Имя подписчика есть только у `event`: у команды владелец один, и
        // его имя — имя самой операции
        found.push({ wired, subscriber: binding.subscriber ?? subject });
      }
    }

    return found;
  }

  /** Subject'ы шины, обслуживаемые сборкой — для текста ошибки адресации */
  #busSubjects(): readonly string[] {
    const subjects = new Set<string>();

    for (const wired of this.#wired.endpoints.values()) {
      const binding = busBindingOf(wired.declaration);

      if (binding) {
        subjects.add(binding.subject);
      }
    }

    return [...subjects].sort();
  }

  /** Endpoint приложения или ошибка с перечнем доступных */
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
 * Endpoint без `input`-формы вызывается одним аргументом. Endpoint со
 * схемой обязан получить payload — иначе это ошибка компиляции, а не
 * отказ валидации в рантайме.
 */
type CallArgs<I extends AnyPayload> =
  undefined extends InferInput<I>
    ? [input?: InferInput<I>, options?: TestCallOptions]
    : [input: InferInput<I>, options?: TestCallOptions];

/**
 * Fail-fast `emit` для JS-потребителей.
 *
 * Типы делают `request` в этой позиции невыразимым, но JS-потребителей типы
 * не сдерживают: без проверки вызов ушёл бы в поиск подписчиков и вернул бы
 * пустой список, ничего не сказав про вид операции.
 */
function assertEmitting(
  operation: unknown,
): asserts operation is EmittingOperation<any, any, any, any> {
  const kind = (operation as { kind?: unknown } | undefined)?.kind;
  const name = (operation as { name?: unknown } | undefined)?.name;

  if (typeof name !== 'string' || typeof kind !== 'string') {
    throw new TypeError(
      `app.emit(operation, …): the first argument must be a operation value ` +
        `created by makeRequest / makeCommand / makeEvent.`,
    );
  }

  if (kind === 'request') {
    throw new TypeError(
      `app.emit(${name}, …): '${name}' is a 'request' operation — it has one ` +
        `owner answering a caller, not subscribers to broadcast to. Drive its ` +
        `implementation with app.call(...) instead.`,
    );
  }
}

/**
 * Собирает тестовое приложение и останавливает его после фазы 3 WIRE.
 *
 * Та же декларация, что у `main.ts`, плюс выбор фич, `overrides`, `stubs`
 * и конфиг теста; те же fail-fast'ы ASSEMBLE — сверка требуемых
 * транспортов, формы io против способностей транспорта, ацикличность
 * графа и объявленные политики.
 *
 * @param app - Декларация приложения (`makeApp`)
 * @param options - Выбор фич и подстановки
 * @returns Приложение с `call`/`get`/`pruned`/`close`
 * @throws {TypeError} Если первый аргумент — не декларация `makeApp`
 *
 * @example
 * ```typescript
 * import { app } from './app.js';
 *
 * await using testApp = await assembleTest(app, {
 *   overrides: [
 *     [UsersRepository, inMemoryUsersRepo()],
 *     familyOverride(ILogger, () => noopLogger),
 *   ],
 *   config: vars({ USERS_PAGE_SIZE: '10' }),
 * });
 * ```
 */
export async function assembleTest<const L extends readonly TestOverride[]>(
  app: App,
  options: TestAssemblyOptions<L> & { overrides?: ValidatedOverrides<L> } = {},
): Promise<TestApp> {
  if (!isApp(app)) {
    throw new TypeError(
      'assembleTest(app, options): the first argument must be an ' +
        'application declaration created by makeApp({ … }); the assembly ' +
        'dictionary is not accepted here.',
    );
  }

  const { tokens, families } = splitOverrides(
    options.overrides as readonly TestOverride[] | undefined,
  );

  const wired = await wireApp(app, {
    ...(options.select === undefined ? {} : { select: options.select }),
    // Стаб — поставка недостающего, а не подмена: обычный провайдер
    providers: (options.stubs ?? []).map(([token, value]) =>
      valueProvider(token, value),
    ),
    // Конфиг теста заменяет привязку декларации; без него декларация
    // читает свои источники
    ...(options.config === undefined
      ? {}
      : { config: toBindings(options.config) }),
    overrides: tokens,
    familyOverrides: families,
  });

  return new TestApp(wired, stubbedOperations(options.stubs));
}
