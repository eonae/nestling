/**
 * `assembleTest` — тестовый composition root и `TestApp` вокруг него.
 *
 * Собственного фазового рантайма здесь нет: пакет заводит **тот же** `App`
 * через шов `@nestling/app/testing` и останавливает его после фазы 3 WIRE.
 * Второй рантайм рядом с первым разошёлся бы с ним уже на первом change'е.
 */

import type { TestConfig } from './config.js';
import { toBindings } from './config.js';
import type { TestOverride, ValidatedOverrides } from './overrides.js';
import { splitOverrides } from './overrides.js';
import type { OperationStub } from './stub.js';
import { stubbedContracts } from './stub.js';

import type { Feature, FeatureSelection, Plugin } from '@nestling/app';
import type { WiredApp, WiredEndpoint } from '@nestling/app/testing';
import { wireApp } from '@nestling/app/testing';
import type { InjectionToken, Provider } from '@nestling/container';
import { valueProvider } from '@nestling/container';
import type {
  CommandMeta,
  EmittingOperation,
  InvokeArgs,
} from '@nestling/contracts';
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
  Policy,
  Raw,
  ResponseContext,
} from '@nestling/pipeline';
import { makeEmptyContext, transportNameOf } from '@nestling/pipeline';
import { busBindingOf, profileAttributes } from '@nestling/ports';
import type {
  DispatchOptions,
  TransportDeclaration,
} from '@nestling/transport';

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
 * Словарь тестовой сборки: боевой плюс `overrides` и `stubs`.
 *
 * @template L - Список подстановок; выводится из литерала, чтобы каждая
 * пара проверялась по типу своего токена
 */
export interface TestAssemblySpec<
  L extends readonly unknown[] = readonly TestOverride[],
> {
  /** Сквозная инфраструктура — та же, что в бою */
  plugins?: readonly Plugin[];

  /** Провайдеры корня */
  providers?: readonly Provider[];

  /** Фичи приложения; подмножество выбирается полем `select` */
  features?: readonly Feature[];

  /** Выбор фич — тот же, что в бою: опечатка падает на фазе 0 */
  select?: FeatureSelection;

  /**
   * Транспорты — объявляются так же, как в проде.
   *
   * Автоподстановки нет: endpoint на транспорте, которого нет в графе, —
   * тот же fail-fast ASSEMBLE, что и в бою. Сокет всё равно не откроется,
   * потому что START не выполняется.
   */
  transports?: readonly TransportDeclaration[];

  /** Транспорт, переносящий операции между процессами: имя экземпляра */
  intercom?: string;

  /** Конфиг: источник, одна привязка или их список */
  config?: TestConfig;

  /**
   * Инварианты сборки — те же значения, что в бою.
   *
   * Тестовый корень их **не ослабляет**: приложение, которое не собирается
   * в проде, не должно собираться и в тесте.
   */
  policies?: readonly Policy[];

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
   *     .flatMap(({ report }) => report.contracts.map((c) => c.name)),
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
   * со `status` и `code` из закрытого операции `errors:`
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
   * @param contract - Операция вида `command` или `event`
   * @returns Ответы подписчиков с именем каждого, в порядке discovery
   * @throws {TypeError} Если операция — `request` (у него нет подписчиков)
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
    contract: C,
    ...args: InvokeArgs<C>
  ): Promise<readonly EmitDelivery[]> {
    const [payload, meta] = args;

    assertEmitting(contract);

    const subscribers = this.#busEndpoints(contract.name);

    if (subscribers.length === 0) {
      if (contract.kind === 'event') {
        // Broadcast с нулём подписчиков — допустимое состояние
        return [];
      }

      throw new Error(
        `Operation '${contract.name}' (kind 'command') has no owner in the ` +
          `assembled application: no registered module declares ` +
          `implement(${contract.name}, { … }) — check that the feature ` +
          `owning it is part of 'select'. Available subjects: ` +
          `${this.#busSubjects().join(', ') || '(none)'}.`,
      );
    }

    const attributes = profileAttributes({
      subject: contract.name,
      deadline: meta?.deadline,
      ...(contract.kind === 'command'
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
        // его имя — имя самого операции
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
  contract: unknown,
): asserts contract is EmittingOperation<any, any, any, any> {
  const kind = (contract as { kind?: unknown } | undefined)?.kind;
  const name = (contract as { name?: unknown } | undefined)?.name;

  if (typeof name !== 'string' || typeof kind !== 'string') {
    throw new TypeError(
      `app.emit(contract, …): the first argument must be a contract value ` +
        `created by makeRequest / makeCommand / makeEvent.`,
    );
  }

  if (kind === 'request') {
    throw new TypeError(
      `app.emit(${name}, …): '${name}' is a 'request' contract — it has one ` +
        `owner answering a caller, not subscribers to broadcast to. Drive its ` +
        `implementation with app.call(...) instead.`,
    );
  }
}

/**
 * Собирает тестовое приложение и останавливает его после фазы 3 WIRE.
 *
 * Тот же словарь сборки, что у `assemble`, плюс `overrides` и `stubs`; те
 * же fail-fast'ы ASSEMBLE — сверка требуемых транспортов, формы io против
 * способностей транспорта, ацикличность графа и объявленные политики.
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
    plugins: spec.plugins,
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
    ...(spec.intercom === undefined ? {} : { intercom: spec.intercom }),
    config: toBindings(spec.config),
    policies: spec.policies,
    overrides: tokens,
    familyOverrides: families,
  });

  return new TestApp(wired, stubbedContracts(spec.stubs));
}
