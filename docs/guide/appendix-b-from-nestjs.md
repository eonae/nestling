# Приложение Б. Из NestJS

> Соответствия сверены с design/ и README пакетов (2026-09-03).

Таблицы ниже отвечают на вопрос «чем в Nestling записывается то, что в
NestJS я делал вот так». В колонке «Чем отличается» одна фраза о
различии, которое влияет на код. Подробности в главах, на которые
ссылается последняя колонка.

## Структура приложения

| NestJS | Nestling | Чем отличается | Глава |
|---|---|---|---|
| `NestFactory.create(AppModule)` и `app.listen()` | `assemble({ features, transports }).run()` | `assemble` проводит приложение по фазам и сам устанавливает остановку по `SIGTERM` | [1](./01-first-service.md) |
| `@Module({ providers, imports })` | `makeModule({ providers, dependsOn })` | модуль это объект, а не класс; хуков жизненного цикла у модуля нет | [11](./11-features.md) |
| `@Module({ controllers })` | `makeFeature({ providers, endpoints })` | endpoint'ы перечисляет фича, а не модуль; фича может быть вынесена в отдельный процесс | [1](./01-first-service.md), [11](./11-features.md) |
| `exports` модуля | нет | видимость держат ES-модули: токен, который не экспортирован из файла, нельзя инжектировать | [4](./04-repository.md) |
| `@Global()` | `makePlugin` и поле `plugins:` корня | плагин есть в каждом процессе, и к нему обращаются токеном | [11](./11-features.md) |
| `DynamicModule`, `forRoot(options)` | функция, которая возвращает модуль или плагин | значение создаётся один раз и передаётся в корень | [11](./11-features.md) |
| `@Controller()` с `@Get()`, `@Post()` | `httpEndpoint({ method, path, input, output, handle })` | endpoint это значение с адресом, схемами и хендлером; класс-хендлер остаётся как одна из форм | [1](./01-first-service.md), [приложение А](./appendix-a-alternatives.md) |

## Зависимости

| NestJS | Nestling | Чем отличается | Глава |
|---|---|---|---|
| `@Injectable()` с `emitDecoratorMetadata` | `@Injectable([deps])` | зависимости перечисляются явным списком токенов; `reflect-metadata` не нужен | [4](./04-repository.md) |
| `@Inject(TOKEN)` | токен в списке `deps` и позиция в конструкторе | интерфейс получает токен `Name$` через `makeToken` | [4](./04-repository.md) |
| `forwardRef()` | нет | цикл зависимостей это ошибка `build()` | [4](./04-repository.md) |
| `Scope.REQUEST` | `Ctx(Var)` и слой пайплайна, который кладёт значение | провайдеры остаются синглтонами, а данные запроса читаются из асинхронного контекста | [7](./07-logging.md) |
| `Scope.TRANSIENT` с `INQUIRER` | `Family.auto` | член семейства с именем потребителя создаётся при сборке, а не на каждый инжект | [20](./20-token-families.md) |
| провайдер с `useFactory` и `inject` | `factoryProvider(token, factory, deps)` | тот же смысл, зависимости позиционные | [4](./04-repository.md) |
| `OnModuleInit`, `OnApplicationBootstrap`, `OnModuleDestroy` | `@OnInit()`, `@OnStart()`, `@OnDestroy()` на методах провайдера | хуки вызываются в топологическом порядке графа, только на провайдерах | [4](./04-repository.md) |
| `ModuleRef.get()` | нет | контейнер наружу не отдаётся; инстансы получают через `deps` или в `@OnStart` | [4](./04-repository.md) |

## Обработка запроса

| NestJS | Nestling | Чем отличается | Глава |
|---|---|---|---|
| `@Param()`, `@Query()`, `@Body()` | схема `input` и правило размещения полей | поле берётся из пути по имени параметра, из query для методов без тела, из тела для остальных; `bind` меняет место | [2](./02-input.md) |
| `ValidationPipe` с class-validator | схема `input` | вход проверяется всегда, до хендлера, по Standard Schema: zod, valibot, arktype | [2](./02-input.md) |
| `Middleware` | юнит `.pre` | юнит дополняет контекст типизированными полями и не вызывает `next()` | [7](./07-logging.md) |
| `Guard` | юнит `.pre`, который возвращает отказ | отказ объявляется в `errors:` endpoint'а; хендлер не вызывается | [8](./08-auth.md) |
| `Interceptor` | юниты `.pre`, `.ok`, `.finally` | вместо обёртки вокруг вызова три отдельные фазы | [7](./07-logging.md) |
| `ExceptionFilter` | юнит `.catch` | заменяет один отказ другим; превратить отказ в успех нельзя | [приложение А](./appendix-a-alternatives.md) |
| `HttpException` | `defineFail` и список `errors:` | отказ это значение с машинным кодом; отказ вне списка становится `UNKNOWN` | [3](./03-errors.md) |
| `@HttpCode(201)`, `@Header()` | `Ok.created(value, headers)`, `new Ok(value, headers)` | статус и заголовки задаются на значении ответа | [3](./03-errors.md) |
| `StreamableFile`, ответ через `@Res()` | формы io `stream(T)`, `events(T)`, `multipart()` | хендлер возвращает `AsyncIterable`, транспорт выбирает NDJSON или SSE | [9](./09-files-and-streams.md), [13](./13-live-feed.md) |
| `FileInterceptor` | `multipart({ fields, files })` и `upload({ maxSize, mime })` | лимит и тип проверяются во время разбора, файл сверх лимита не буферизуется | [9](./09-files-and-streams.md) |
| `@nestjs/swagger` декораторы | плагин `openapi()` и слот `doc:` | документ выводится из тех же схем, что проверяют запросы | [10](./10-openapi-and-client.md) |

## Взаимодействие частей приложения

| NestJS | Nestling | Чем отличается | Глава |
|---|---|---|---|
| инжект сервиса другого модуля | операция `makeRequest` и `Operation.caller` | фичи связаны только операциями; прямое ребро между фичами это ошибка сборки | [11](./11-features.md) |
| `EventEmitter2`, `@OnEvent()` | `makeEvent`, `Operation.emitter`, `implement(Event, { subscriber })` | событие описано схемой; подписчик именуется явно | [12](./12-events.md) |
| `@MessagePattern()`, `ClientProxy` | `implement(Operation)` и `Operation.caller` | код вызова одинаков в одном процессе и через брокер | [11](./11-features.md), [16](./16-split.md) |
| `@nestjs/microservices` с транспортом NATS | `nats()` в `transports:` и `intercom:` | шина это обычный транспорт, а роль переносчика операций назначается полем корня | [16](./16-split.md) |
| HTTP-клиент, написанный руками | `makeClient(operations, config)` | клиент собирается из тех же операций и восстанавливает отказы по коду | [10](./10-openapi-and-client.md) |

## Конфигурация и тесты

| NestJS | Nestling | Чем отличается | Глава |
|---|---|---|---|
| `ConfigModule.forRoot()` и `ConfigService.get('X')` | `makeConfig(prefix, fields)` и инжект секции | секция типизирована схемой и проверяется на старте; регистрировать её не нужно | [5](./05-config.md) |
| `ConfigModule` с `load` и `validationSchema` | `config: [[источник, Section.keys]]` в корне | источник привязывается к ключам, а не к модулю | [21](./21-config-sources.md) |
| `Test.createTestingModule()` с `overrideProvider()` | `assembleTest({ …, overrides })` | тест собирает то же приложение по тем же фазам; сокет не открывается | [6](./06-testing.md) |
| `supertest` против `app.getHttpServer()` | `app.call(Endpoint, payload)` | запрос идёт через полный пайплайн без сети; e2e на порту `0` остаётся отдельным уровнем | [6](./06-testing.md), [14](./14-testing-features.md) |
| мок сервиса соседнего модуля | `stubs: [stub(Operation, impl)]` | ответ заглушки проверяется схемой операции | [14](./14-testing-features.md) |

## Чего в Nestling нет

- `forwardRef`: цикл зависимостей не собирается.
- Скоупов `REQUEST` и `TRANSIENT`: данные запроса живут в асинхронном
  контексте, экземпляр на потребителя даёт семейство токенов.
- `exports` у модуля: границу видимости держат ES-модули.
- `next()` в обработке запроса: юниты пайплайна не оборачивают друг
  друга.
- Отдельного слоя контроллеров: endpoint это декларация с хендлером.
