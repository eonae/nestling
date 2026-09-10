# Соглашения об именовании

> Правила для кода приложения на Nestling: имена деклараций, схем,
> отказов, DI-токенов, хендлеров и файлов. Гайд и примеры
> (`examples/*`) следуют этим правилам; правила линтера пишутся
> по этому документу. Термины берутся из [глоссария](./glossary.md).

## Endpoint'ы и операции

- Имя endpoint'а и операции это глагол с объектом в PascalCase:
  `GetUser`, `CreateUser`, `CheckHealth`. Существительное без глагола
  (`Health`, `Users`) именем не является.
- Endpoint и операция, которую он обслуживает, называются одинаково.
  Различает их файл: операция лежит в `api/operations.ts`, endpoint в
  `<имя>.endpoint.ts`. В файле endpoint'а операция импортируется с
  суффиксом: `import { GetUser as GetUserOperation }`.
- Поле `name` операции строится из имени фичи и глагола через точку, в
  нижнем регистре: `users.get`, `users.create`.

## Схемы

- Схема входа называется по операции с суффиксом `Input`:
  `CreateUserInput`, `ListUsersInput`. Тип выводится из схемы под тем же
  именем: `type CreateUserInput = z.infer<typeof CreateUserInput>`.
- Схема выхода называется по сущности, которую описывает: `User`.
  Суффикс `Output` получает только форма, которая существует ради одного
  endpoint'а: `ExportUsersOutput`.

## Отказы

- Определение отказа называется по событию, без суффиксов `Error`,
  `Fail` и `Exception`: `UserNotFound`, `EmailTaken`. Определения ядра
  называются по категории: `BadRequest`, `Timeout`, `InternalError`.
- Код отказа состоит из сегментов через двоеточие. Каждый сегмент
  соответствует `[a-z_]+`. Первый сегмент это категория из закрытого
  перечня (`not_found`, `conflict`, `unauthorized`, …), остальные
  уточняют её: `not_found:user`, `conflict:email_taken`. Код из одной
  категории допустим: `unauthorized`.

## DI-токены и провайдеры

- Класс сам себе DI-токен и называется как класс: `Database`.
- DI-токен интерфейса называется как интерфейс с суффиксом `$`:
  `UsersRepository$` для `UsersRepository`. Так же названы DI-токены ядра
  и семейства: `HttpTransport$`, `RootLogger$`, `Logger$`, `HealthCheck$`.
  Других правил для суффикса нет.
- Роль класса задаёт декоратор: `@Component([deps])` для сервиса,
  `@Resource([deps])` для пула или соединения, `@Handler([deps])` для
  хендлера. Реализация интерфейса регистрируется в `providers:` через
  `classProvider(UsersRepository$, DbUsersRepository)`.
- Класс, реализующий интерфейс, получает префикс по способу реализации:
  `DbUsersRepository`. Фейк для тестов называется по той же схеме в
  lowerCamelCase, если это функция: `inMemoryUsersRepo`.
- Секция конфига называется `<Имя>Config`, префикс секции пишется в
  нижнем регистре: `AppConfig = makeConfig('app', …)`. Имя переменной
  окружения складывается из префикса и имени поля: `APP_PAGE_SIZE`.

## Хендлеры

- Класс-хендлер называется по операции с суффиксом `Handler`:
  `GetUserHandler`. Метод называется `handle`. Класс помечается
  `@Handler([deps])` и может объявлять `implements Handler<typeof GetUser>`;
  HTTP-хендлер объявляет `implements HttpHandler<typeof Login>`.
- Хендлер-функция называется по операции в lowerCamelCase с суффиксом
  `Handler`: `getUserHandler`.
- Реализация операции (`implement`) — значение с суффиксом `Impl`:
  `ClaimQuotaImpl`. Её класс-хендлер называется по операции:
  `ClaimQuotaHandler`.
- Подписчик события — значение `<Событие>In<Фича>`:
  `UserRegisteredInQuotas`. Его класс-хендлер добавляет тот же суффикс:
  `UserRegisteredInQuotasHandler`. Имя фичи в значении совпадает со
  строкой `subscriber:`.

## Переключатели

- Переключатель называется по тому, что он выбирает, в PascalCase:
  `Storage = makeSwitch('storage', ['s3', 'local'])`. Имя в нижнем
  регистре совпадает с полем `RootConfig`, из которого приходит значение:
  `storage: Storage.schema`.
- Двухпозиционный переключатель называется по тому, что включает:
  `Metrics = makeSwitch('metrics')`.

## Пайплайн

- Слой это значение в lowerCamelCase, названное по тому, что он даёт:
  `observability`, `authed`.
- Класс-юнит называется по действию: `Authenticate`, `AuditOutcome`.

## Файлы

- Один endpoint на файл: `<имя-через-дефис>.endpoint.ts`, например
  `get-user.endpoint.ts`. Реализация операции — тоже endpoint, поэтому
  файл называется так же: `claim-quota.endpoint.ts`,
  `user-registered-in-quotas.endpoint.ts`.
- Реализации, объявленные прямо в файле фичи, выносятся по файлам, как
  только их становится больше одной: файл фичи перечисляет состав, а не
  хранит исполнение.
- Фича: `<имя>.feature.ts`. Плагин: `<имя>.plugin.ts`. Репозиторий:
  `<имя>.repository.ts`. Отказы фичи: `<имя>.errors.ts`. Секция конфига:
  `<имя>.config.ts`. Переключатели приложения: `switches.ts`.
- Операции, которые импортирует клиент, лежат в `api/operations.ts`.
  Файл импортирует только `@nestlingjs/operations`, схемы и определения
  отказов.
- `app.ts` объявляет и экспортирует `app`: результат `makeApp`. `main.ts`
  импортирует `app` и запускает его. Других экспортов у `main.ts` нет.
