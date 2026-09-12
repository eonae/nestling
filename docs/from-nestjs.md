# Из NestJS

> Соответствия сверены с `design/` и README пакетов (2026-09-08).

Таблицы ниже отвечают на вопрос «чем в Nestling записывается то, что в
NestJS я делал вот так». В колонке «Чем отличается» одна фраза о
различии, которое влияет на код. Подробности в главах, на которые
ссылается последняя колонка.

## Структура приложения

| NestJS | Nestling | Чем отличается | Глава |
|---|---|---|---|
| `NestFactory.create(AppModule)` и `app.listen()` | `makeApp({ features, transports }).assemble().run()` | `run()` проводит приложение по фазам и сам устанавливает остановку по `SIGTERM` | [1](./guide/01-first-service.md) |
| `@Module({ providers, imports })` | `makeModule({ providers, dependsOn })` | модуль это объект, а не класс; хуков жизненного цикла у модуля нет | [14](./guide/14-features.md) |
| `@Module({ controllers })` | `makeFeature({ providers, endpoints })` | endpoint'ы перечисляет фича, а не модуль; фича может быть вынесена в отдельный процесс | [1](./guide/01-first-service.md), [14](./guide/14-features.md) |
| `exports` модуля | нет | видимость держат ES-модули: DI-токен, который не экспортирован из файла, нельзя инжектировать | [6](./guide/06-repository.md) |
| `@Global()` | `makePlugin` и поле `plugins:` корня | плагин есть в каждом процессе, и к нему обращаются DI-токеном | [14](./guide/14-features.md) |
| `DynamicModule`, `forRoot(options)` | функция, которая возвращает модуль или плагин | значение создаётся один раз и передаётся в корень | [14](./guide/14-features.md) |
| `@Controller()` с `@Get()`, `@Post()` | `httpEndpoint({ method, path, input, output, handler })` | endpoint это значение с адресом, схемами и хендлером; хендлер — функция или класс с методом `handle` | [1](./guide/01-first-service.md), [5](./guide/05-handler-class.md) |

## Зависимости

| NestJS | Nestling | Чем отличается | Глава |
|---|---|---|---|
| `@Injectable()` с `emitDecoratorMetadata` | `@Component([deps])`, `@Resource([deps])`, `@Handler([deps])` | декоратор называет роль класса, зависимости перечисляются явным списком DI-токенов; `reflect-metadata` не нужен | [6](./guide/06-repository.md) |
| `@Inject(TOKEN)` | DI-токен в списке `deps` и позиция в конструкторе | интерфейс получает DI-токен `Name$` через `makeToken` | [6](./guide/06-repository.md) |
| `forwardRef()` | нет | цикл зависимостей это ошибка `build()` | [6](./guide/06-repository.md) |
| `Scope.REQUEST` | `Ctx(Var)` и слой пайплайна, который кладёт значение | провайдеры остаются синглтонами, а данные запроса читаются из асинхронного контекста | [9](./guide/09-logging.md) |
| `Scope.TRANSIENT` с `INQUIRER` | `Family.auto` | член семейства с именем потребителя создаётся при сборке, а не на каждый инжект | [рецепт](./recipes/token-families.md) |
| провайдер с `useFactory` и `inject` | `factoryProvider(token, factory, deps)` | тот же смысл, зависимости позиционные | [6](./guide/06-repository.md) |
| `OnModuleInit`, `OnApplicationBootstrap`, `OnModuleDestroy` | `static acquire` и `release` ресурса, `@OnStart()` на методе провайдера | захват идёт в топологическом порядке графа, освобождение — в обратном; хук старта один | [6](./guide/06-repository.md) |
| `ModuleRef.get()` | нет | контейнер наружу не отдаётся; инстансы получают через `deps` или в `@OnStart` | [6](./guide/06-repository.md) |

## Обработка запроса

| NestJS | Nestling | Чем отличается | Глава |
|---|---|---|---|
| `@Param()`, `@Query()`, `@Body()` | схема `input` и правило размещения полей | поле берётся из пути по имени параметра, из query для методов без тела, из тела для остальных; `bind` меняет место | [3](./guide/03-input.md) |
| `ValidationPipe` с class-validator | схема `input` | вход проверяется всегда, до хендлера, по Standard Schema: zod, valibot, arktype | [3](./guide/03-input.md) |
| `Middleware` | юнит `.pre` | юнит дополняет контекст типизированными полями и не вызывает `next()` | [9](./guide/09-logging.md) |
| `Guard` | юнит `.pre`, который возвращает отказ | отказ объявляется в `errors:` endpoint'а; хендлер не вызывается | [10](./guide/10-auth.md) |
| `Interceptor` | юниты `.pre`, `.ok`, `.finally` | вместо обёртки вокруг вызова три отдельные фазы | [9](./guide/09-logging.md) |
| `ExceptionFilter` | юнит `.catch` | заменяет один отказ другим; превратить отказ в успех нельзя | [рецепт](./recipes/alternatives.md) |
| `HttpException` | `makeFail` и список `errors:` | отказ это значение с машинным кодом; отказ вне списка становится `internal_error` | [4](./guide/04-errors.md) |
| `@HttpCode(201)` | `Ok.created(value)` | статус успеха задаётся на значении ответа и от транспорта не зависит | [4](./guide/04-errors.md) |
| `@Header()`, `@Res().cookie()`, `@Redirect()` | `HttpResponse.of(ok, { headers, cookies })`, `HttpResponse.redirect(location)` | заголовок, cookie и редирект — HTTP-форма ответа; она допустима там, где адрес объявлен транспортом | [10](./guide/10-auth.md) |
| `StreamableFile`, ответ через `@Res()` | формы io `stream(T)`, `events(T)`, `multipart()` | хендлер возвращает `AsyncIterable`, транспорт выбирает NDJSON или SSE | [12](./guide/12-files-and-streams.md), [17](./guide/17-live-feed.md) |
| `FileInterceptor` | `multipart({ fields, files })` и `upload({ maxSize, mime })` | лимит и тип проверяются во время разбора, файл сверх лимита не буферизуется | [12](./guide/12-files-and-streams.md) |
| `@nestjs/swagger` декораторы | плагин `openapi()` и слот `doc:` | документ выводится из тех же схем, что проверяют запросы | [13](./guide/13-openapi-and-client.md) |

## Взаимодействие частей приложения

| NestJS | Nestling | Чем отличается | Глава |
|---|---|---|---|
| инжект сервиса другого модуля | операция `makeRequest` и `Operation.caller` | фичи связаны только операциями; прямое ребро между фичами это ошибка сборки | [14](./guide/14-features.md) |
| `EventEmitter2`, `@OnEvent()` | `makeEvent`, `Operation.emitter`, `implement(Event, { subscriber })` | событие описано схемой; подписчик именуется явно | [15](./guide/15-events.md) |
| `@MessagePattern()`, `ClientProxy` | `implement(Operation)` и `Operation.caller` | код вызова одинаков в одном процессе и через брокер | [14](./guide/14-features.md), [20](./guide/20-split.md) |
| `@nestjs/microservices` с транспортом NATS | `nats()` в `transports:` и `intercom:` | шина это обычный транспорт, а роль переносчика операций назначается полем корня | [20](./guide/20-split.md) |
| HTTP-клиент, написанный руками | `makeClient(operations, config)` | клиент собирается из тех же операций и восстанавливает отказы по коду | [13](./guide/13-openapi-and-client.md) |

## Конфигурация и тесты

| NestJS | Nestling | Чем отличается | Глава |
|---|---|---|---|
| `ConfigModule.forRoot()` и `ConfigService.get('X')` | `makeConfig(prefix, fields)` и инжект секции | секция типизирована схемой и проверяется на старте; регистрировать её не нужно | [7](./guide/07-config.md) |
| `ConfigModule` с `load` и `validationSchema` | `config: [[источник, Section.keys]]` в корне | источник привязывается к ключам, а не к модулю | [рецепт](./recipes/config-sources.md) |
| `Test.createTestingModule()` с `overrideProvider()` | `assembleTest(app, { overrides })` | тест собирает то же приложение по тем же фазам; сокет не открывается | [8](./guide/08-testing.md) |
| `supertest` против `app.getHttpServer()` | `testApp.call(Endpoint, payload)` | запрос идёт через полный пайплайн без сети; e2e на порту `0` остаётся отдельным уровнем | [8](./guide/08-testing.md), [18](./guide/18-testing-features.md) |
| мок сервиса соседнего модуля | `stubs: [stub(Operation, impl)]` | ответ заглушки проверяется схемой операции | [18](./guide/18-testing-features.md) |

## Чего в Nestling нет

- `forwardRef`: цикл зависимостей не собирается.
- Скоупов `REQUEST` и `TRANSIENT`: данные запроса живут в асинхронном
  контексте, экземпляр на потребителя даёт семейство DI-токенов.
- `exports` у модуля: границу видимости держат ES-модули.
- `next()` в обработке запроса: юниты пайплайна не оборачивают друг
  друга.
- Отдельного слоя контроллеров: endpoint это декларация с хендлером.
