# Контейнер: DI, модули, token families

> **Целевое состояние V1.** Логика решений: [ideas.md](../decisions/ideas.md) —
> «Token families + модули без рантайм-инкапсуляции» [2026-07-06],
> «Multi-injection через token families: `Family.all`» [2026-07-10],
> «Kernel/user space; конфиг как token-families» [2026-07-08],
> «Асинхронный контекст» [2026-07-10], «Endpoint-декларации» [2026-07-13].
> Статус реализации — [roadmap](../decisions/roadmap.md).

## Провайдеры и токены

Зависимости объявляются **явным массивом токенов** — никакого
`reflect-metadata` и инжекта «по типу»:

```typescript
@Injectable([UserRepository, ILogger('users')])
export class UserService {
  constructor(
    private repo: UserRepository,
    private logger: ILoggerService,
  ) {}
}
```

- **Класс — сам себе токен**; `@Injectable([deps])` — стандартный
  ES-декоратор (не `experimentalDecorators`), несущий только список deps.
- **Интерфейсы и значения** — через явные токены (`token<T>(id)`) и
  примитивы `classProvider(token, Class)` / `factoryProvider(token, fn, deps)` /
  `valueProvider(token, value)`. Это низкоуровневые кирпичи контейнера
  (интерфейс-токены, конфиг, тесты), а не отдельный «стиль».
- Цена дублирования списка (декоратор + конструктор) — осознанный trade-off
  за отсутствие магии компилятора.

## Жадная сборка

`build()` инстанцирует **весь граф сразу**: топологическая сортировка,
проверка циклов, недостающих узлов и (opt-in) видимости — всё падает на
старте, не в рантайме. `forwardRef` не существует как понятие. Граф полный
и интроспектируемый: визуализация, атрибуция узлов модулям, топологический
init/destroy.

Lifecycle-хуки провайдеров: `@OnInit` (захват ресурсов), `@OnStart`
(go-live), `@OnDestroy` (освобождение, в реверсе топосорта) — семантика фаз
в [composition.md](./composition.md). Lifecycle — свойство классов-провайдеров;
у factory-провайдеров его нет.

## Модули — plain objects

Модуль — значение: метка принадлежности, единица упаковки, метаданные для
графа. Рантайм-инкапсуляции (нестовские `exports`) нет — **видимость решают
ES-модули**: не экспортировал токен из пакета — снаружи его физически нечем
запросить.

```typescript
export const OrdersModule = makeModule({
  name: 'module:orders',
  providers: [OrdersService, OrdersRepository],
  endpoints: [CreateOrder],          // декларации — значения (endpoints.md)
});
```

- **Параметризованный модуль — просто функция**, возвращающая модуль:
  `LoggingModule({ level: 'debug' })`. Понятия `DynamicModule` /
  `forRoot` / `forRootAsync` не нужны.
- **`strictExports`** (opt-in) — build-time проверка рёбер готового графа
  против деклараций exports: lint на сборке, не рантайм-ACL.
- Дискавери провайдеров, endpoints и транспортов — **обходом дерева
  зарегистрированных модулей**; глобальных реестров-при-импорте нет.

## Token families

Семейство токенов — один рецепт, много инстансов по ключу. Покрывает
параметризованные провайдеры, consumer-aware инжект и multi-injection —
статически, на сборке:

```typescript
const ILogger = makeTokenFamily<ILoggerService, [scope: string]>('Logger');

// инфраструктурный модуль регистрирует ОДИН рецепт на семейство:
familyProvider(ILogger, (scope) =>
  factoryProvider(ILogger(scope), (cfg) => new Logger(scope, cfg), [IConfig]));

// бизнес-код запрашивает члена как обычную зависимость:
@Injectable([UserService, ILogger('users')])
class CreateUserEndpoint { /* ... */ }
```

- `ILogger('users')` — мемоизированный токен-член (`Logger:users`); билдер
  собирает все члены, упомянутые в deps, и материализует их рецептом —
  обычные узлы графа, жадно.
- **`.auto`** — consumer-aware сахар: `ILogger.auto` резолвится в
  `ILogger('CreateUserEndpoint')` в момент регистрации (потребитель известен
  статически). Кейс Nest `transient + INQUIRER` без transient-скоупа.
- **`.all`** — multi-injection: агрегирующий токен `TokenString<readonly T[]>`.
  Вклады — обычные провайдеры с членскими токенами
  (`classProvider(IHealthCheck('db'), DbHealthCheck)`), регистрируются
  независимо разными модулями; билдер на `build()` создаёт синтетический
  узел-агрегат с массивом инстансов — заморожен, порядок = порядок регистрации
  вкладов (явные, затем материализованные фикспоинтом), пустое семейство даёт
  `[]`. Узел безмодульный, поэтому под `strictExports` вклад требует
  `exports` у своего модуля. Не выбрал фичу → её вкладов нет в массиве — тем же
  механизмом, что и всё остальное. Никакого `multi: true` на общем токене:
  каждый вклад индивидуально адресуем.
- Конфиг — частный случай семейств ([config.md](./config.md)); on-demand
  клиенты (`GrpcClient(server)` + unbound-ключи) — тоже.

## Kernel space / user space

Граница как в ОС: **kernel** (токены не экспортируются) — источники конфига,
транспорты, шина и port-клиенты, машинерия графа и lifecycle; **user space** —
сервисы, endpoints, контракты, конфиг-как-данные. Пересечение границы — только
через публичные «syscalls»: инжект `Config<X>`, `Port`/`Emitter`, возврат
значения из хендлера. Enforcement — та же ES-видимость, без рантайм-ACL.
User-space код провенанс-слеп и транспорт-слеп: один и тот же бизнес-код
работает локально и в split, с конфигом из env или vault.

## Асинхронный контекст

Для глубоких сервисов (логгер в репозитории тремя слоями ниже хендлера) —
read-only ALS-проекция pipeline-контекста. Формула: **значение едет
ambient'ом, зависимость — явная; запись — монополия pre-юнитов**.

- `contextVar<T>('key')` — branded-ключ (+ флаг `propagate` для remote-портов).
- Доступ — **инжектируемый ридер, член token family**: `Ctx(RequestId)` в
  deps → `CtxReader<string>`. Зависимость от request-контекста — видимое
  ребро DI-графа; полный список ambient-чтений известен на `build()`;
  в тестах подменяется `valueProvider`, ALS не нужен.
- `get(): T` — бросает с диагностикой фазы; `peek(): T | undefined` — для
  ответного тракта, `@OnStart` и фоновых путей (зеркало асимметрии
  пайплайна — [pipeline.md](./pipeline.md)).
- В проекции — только накопленный `input` и `signal` (well-known
  `Ctx(Signal)`); `raw` и `endpoint` в ambient не отдаются — транспорт не
  протекает в домен. Писатель — только рантайм пайплайна; ALS вторым каналом
  записи не является.
- Через in-proc порты контекст течёт сам; через remote — vars с
  `propagate: true` едут в заголовках транспорта.

## Что в контейнер не кладётся

- **Request-состояние** — никогда не в DI: типизированный request-контекст —
  это накопленный `input` пайплайна; для глубоких сервисов — асинхронный
  контекст (выше). Request-scope-провайдеров и их bubbling не существует
  by design.
- **Ленивая инициализация** и **рантайм-подграфы** (child-контейнеры) —
  осознанно вне V1 (см. записи журнала).
