# @nestling/testing

Тестовый composition root. `assembleTest` собирает то же самое приложение,
что и `assemble`, проводит его по фазам `0 BOOTSTRAP`, `1 ASSEMBLE`,
`2 INIT`, `3 WIRE` и останавливается: `dispatch` создан, сокеты не
открыты, обработчики `SIGTERM`/`SIGINT` не установлены, в stdout ничего
не напечатано.

> 🚧 Активная разработка, API меняется. Целевой дизайн:
> [`docs/design/testing.md`](../../docs/design/testing.md).
> Гайд: [`docs/guides/testing.md`](../../docs/guides/testing.md).

Пакет не вводит ни раннера, ни матчеров, ни snapshot-механики: jest
остаётся jest'ом.

## Установка

```bash
npm install --save-dev @nestling/testing
```

Раннер должен включить условие экспорта `"testing"`, см.
[Настройка раннера](#настройка-раннера).

## Минимальный пример

```typescript
import { assembleTest, stub, unwrap, vars } from '@nestling/testing';

await using app = await assembleTest({
  features: [UsersFeature, OpsFeature],
  transports: [http({ port: 0 })],
  overrides: [[UsersRepository, inMemoryUsersRepo()]],
  // заглушка контракта, который эта сборка не реализует
  stubs: [stub(ChargeCard, async ({ amount }) => ({ chargeId: `c-${amount}` }))],
  config: vars({ USERS_PAGE_SIZE: '10' }),
  // те же инварианты, что и в production
  policies: [everyEndpoint({ transport: HttpTransport$ }).hasLayer(authedBase)],
});

expect(unwrap(await app.call(GetUser, { id: '1' }))).toEqual({ id: '1', name: 'Alice' });
```

`assembleTest` асинхронна, поэтому пишите `await using app = await
assembleTest(…)`: `await using` ждёт освобождения ресурса, а не
инициализатор. Форма без `using` тоже работает: `const app = await
assembleTest(…)` и `await app.close()` в `afterEach`. `close()`
идемпотентен.

## Что выполняется в тестовой сборке

| Выполняется | Не выполняется |
|---|---|
| выбор фич, регистрация, discovery, `build()` | `container.start()` и `@OnStart` |
| все проверки ASSEMBLE: транспорты, формы io, циклы, `policies` | `transport.serve(...)`: сокет не открывается |
| `@OnInit` в топологическом порядке | обработчики `SIGTERM`/`SIGINT` |
| WIRE: декларации получают зависимости, создаётся `dispatch` на транспорт | строка состава сборки в stdout |
| `app.call` и `app.emit` через полный пайплайн | сетевой уровень: разбор запроса, заголовки, сокеты |

**`@OnStart` в тесте не вызывается.** Всё, что провайдер открывает в
`@OnStart`, в тесте открыто не будет. Ресурсы, нужные и в тесте
(соединение с БД, клиент брокера), открывайте в `@OnInit`.

## `app.call`: запрос через полный пайплайн

```typescript
const res = await app.call(CreateUser, { name: 'Alice' });
// ResponseContext<User>: { isSuccess: true, status, value }
//                      | { isSuccess: false, status, value: { error, code, … } }
```

Это отличает app-тест от юнит-теста: все слои пайплайна, проверка входа по
схеме `input` и проверка задекларированных ошибок выполняются
по-настоящему. Вход проверяет тот же рантайм, что и при запросе по сети,
включая поля формы `multipart`, поэтому `app.call` и HTTP дают один
результат. Декларация
ищется по идентичности значения: тест держит то же значение, которое модуль
перечислил в `endpoints:`, и никаких строк не сравнивает. Декларация, не
входящая в приложение (модуль не зарегистрирован, фича не выбрана), даёт
ошибку со списком доступных endpoint'ов.

- Тип `input` берётся из формы `input` декларации, тип результата — из
  формы `output`. Ветка ошибки несёт `status` и `code` из списка `errors:`.
- `unwrap(res)` возвращает значение или бросает `UnwrapFailedError` со
  статусом и кодом. Это форма для случая «ожидаю успех».
- Кадр запроса заполнен минимально: `raw.transport` и `raw.pattern` берутся
  из декларации, `raw.attributes` равен `{}`, пока тест не передал
  `options.attributes`. Слой, который читает HTTP-заголовки, ничего не
  увидит.
- Разбор запроса из path, query и body не выполняется: `call` принимает
  готовый payload. Раскладку полей проверяют e2e-тесты и юнит-тесты
  bind-карты.
- `exposeErrorDetails` по умолчанию включён: в тесте детали ошибок нужны.

Опции `call` (`TestCallOptions`): `attributes`, `exposeErrorDetails`,
`onUnknownFail`.

## `overrides`: подмена узлов графа

```typescript
overrides: [
  [UsersRepository, inMemoryUsersRepo()],      // токен и заглушка
  familyOverride(ILogger, () => noopLogger),   // рецепт целого семейства
  contextValue(RequestId, 'req-1'),            // переменная контекста запроса
]
```

Подмена происходит на фазе ASSEMBLE, до создания инстансов. Это не патчинг
и не перехват модульной системы. Поле есть только у тестового корня;
`assemble` его не принимает.

- Пара типизирована: заглушка, не совпадающая с типом токена, не
  компилируется.
- Подмена токена, которого нет в графе, останавливает сборку.
  Переименуйте провайдер, и тест упадёт вместо того, чтобы молча ничего не
  подменять.
- Повторная подмена одного токена останавливает сборку.
- Строковой формы (`overrideByName('…')`) нет: подменить можно только
  токен, на который есть ссылка.
- `contextValue(variable, value)` — сокращённая запись
  `valueProvider(Ctx(variable), reader)`. Читатель переменной контекста
  ([`@nestling/pipeline`](../nestling.pipeline)) — обычный узел графа, и
  подменяется как любой другой. Заданное значение читается и вне запроса
  (при прямом вызове сервиса) и имеет приоритет над рецептом семейства: в
  `app.call` сервис прочитает то, что задал тест, а не то, что записал
  пайплайн. Без `contextValue` работает production-проекция: значение слоя
  внутри вызова, `undefined` из `peek()` снаружи.

Подмена отсекает поддерево, которое больше никому не нужно. Замените
репозиторий заглушкой, и пул `pg` не будет создан, не подключится и не
попадёт в граф. `app.pruned` перечисляет отсечённые идентификаторы;
`app.get(token)` возвращает для них `null`. Без `overrides` граф совпадает
с production-графом.

## `stub(Contract, impl)`: фича без соседей

Фича, которая инжектит `ChargeCard.caller`, не соберётся без соседа: рецепт
вызывателя не проходит проверку достижимости. `stub` возвращает пару
«токен вызывателя и заглушка»: `[C.caller, …]` для `request`-контракта,
`[C.emitter, …]` для `command` и `event`. Пара передаётся в `stubs:`
вместе с обычными парами `[token, value]`; отдельного поля нет.

```typescript
stubs: [
  stub(ClaimQuota, async ({ amount }) => ({ granted: amount })),  // Port<C>
  stub(OrderPlaced, (fact) => void seen.push(fact)),              // Emitter<C>
]
```

Механизм — свойство контейнера: явный провайдер для члена семейства имеет
приоритет над рецептом, поэтому production-код `buildPort` и `buildEmitter`
для заглушенного контракта не вызывается, и проверка достижимости тоже.

Заглушка проверяется схемами своего контракта при каждом вызове:

- вход разбирается формой `input` контракта: неверный payload даёт
  `VALIDATION_FAILED`, и `impl` не вызывается;
- успешный результат разбирается формой `output`, поэтому заглушка,
  разошедшаяся с контрактом, падает сама, а не в потребителе. Это строже
  production-порта внутри процесса: настоящий ответ уже прошёл пайплайн
  реализации, у заглушки пайплайна нет;
- возвращённый или брошенный отказ должен входить в `errors:` контракта
  (плюс коды ядра `VALIDATION_FAILED`, `UNKNOWN`, `DEADLINE_EXCEEDED`).
  Незадекларированный код — дефект теста, поэтому заглушка бросает ошибку с
  именем контракта, кодом и разрешённым набором, а не превращает его в
  `UnknownError`;
- исключение из `impl`, не являющееся `Fail`, пробрасывается как есть.

Параметры вызова тоже воспроизводятся: исчерпанный `meta.deadline` даёт
`DEADLINE_EXCEEDED` до вызова `impl`, а `emit` команды всегда несёт
`idempotencyKey` — переданный вызывающим или сгенерированный заглушкой.

Место вызова совпадает с production (`Port<C>` / `Emitter<C>`, результат
`PortResult<C>`); заглушка, не подходящая контракту, не компилируется.
Своего spy у пакета нет: `impl` — обычная функция, туда подходит
`jest.fn()`.

## `app.emit`: событие или команда снаружи

```typescript
const [{ subscriber, response }] = await app.emit(PlaceOrder, { orderId: 'o-1' });
```

`emit` доставляет событие или команду каждому подписчику в этом процессе,
каждому через его полный пайплайн, и возвращает их ответы вместе с именами
подписчиков (`EmitDelivery[]`).

- транспортные атрибуты несут параметры вызова, включая `idempotencyKey`;
- ноль подписчиков у `event` — допустимая рассылка и пустой список; у
  `command` — ошибка адресации со списком доступных subject'ов;
- `request`-контракт не компилируется: у него один владелец, а не
  подписчики;
- заглушенный эмиттер не мешает: заглушка подменяет то, что приложение
  вызывает наружу, а `emit` ведёт приложение снаружи внутрь.

## `checkTopologies`: матрица топологий

Подмены и заглушки делают тестовый граф меньше production-графа. Полный
граф без подстановок проверяет `App.check()` из
[`@nestling/app`](../nestling.app): фазы 0–1. Этот пакет оборачивает его в
матрицу:

```typescript
await checkTopologies(
  { features: [UsersFeature, OpsFeature], transports: [http({ port: 0 })] },
  ['all', 'users', 'ops'],
);
```

`checkTopologies(spec, selections, options?)` возвращает
`TopologyReport[]` — пары `{ select, report }`. Ядро останавливается на
первой ошибке; хелпер собирает ошибки всех топологий и бросает одно
сообщение с причиной по каждой.

`policies:` из `spec` проверяются в каждой топологии матрицы, поэтому
инвариант, который держится при `select: 'all'` и ломается на
подмножестве, ловится в CI. Причины `detached` приходят значениями в
отчёте, и тест сравнивает набор, а не разбирает stdout:

```typescript
const [{ report }] = await checkTopologies(spec, ['all']);

expect(
  report.endpoints.filter(({ detached }) => detached !== undefined)
    .map(({ pattern }) => pattern),
).toEqual(['GET /health']);
```

### Совместимость контрактов

Отчёт каждой топологии содержит `contracts` — дескрипторы контрактов,
которые топология публикует. Проверка совместимости строится на них без
второй сборки:

```typescript
import {
  checkTopologies, diffContracts, formatCompatibility, snapshotContracts,
} from '@nestling/testing';

const reports = await checkTopologies(spec, ['all', 'users', 'ops'], {
  converters: [zodConverter()],
});

const report = diffContracts(readBaseline(), snapshotContracts(reports));

console.log(formatCompatibility(report));
expect(report.breaking).toEqual([]);
```

`options` передаются в `check()` каждой топологии. Без конвертеров
дескрипторы всё равно строятся: структурная часть (вид, формы io, коды и
статусы ошибок) точная, а листовые схемы помечаются непрозрачными, что даёт
вердикт `unknown`. `diffContracts` — чистая функция от двух значений; она
не участвует в сборке и не бросает ошибок по результату сравнения. Правила
вердиктов и ведение baseline описаны в
[`@nestling/ports`](../nestling.ports).

## `vars()`: конфиг из объекта

```typescript
const src = vars({ RUNTIME_LOG_LEVEL: 'info' });
await using app = await assembleTest({ …, config: src });

src.set('RUNTIME_LOG_LEVEL', 'debug'); // reloadable-секция перепроецируется
```

`vars(record)` возвращает именованный `ObjectSource` с методами `set`,
`assign` и `watch`. `process.env` не трогается, поэтому тесты изолированы
и могут идти параллельно, а механика перезагрузки конфига становится
проверяемой.

Поле `config:` тестового корня принимает три формы: источник (то же, что
`[[source, '*']]`), одну привязку или список привязок. Production
`assemble` принимает только список привязок.

## `testModule`: один модуль отдельно

```typescript
await using app = await testModule(ReportsModule, {
  stubs: [
    [ILogger, noopLogger],
    [IClock, { now: () => 42 }],
    stub(ChargeCard, async () => ({ chargeId: 'c1' })),
  ],
  transports: [http({ port: 0 })],
});
```

`testModule(module, options?)` собирает мини-приложение вокруг одного
модуля с его `imports`, модулем ядра для конфига и перечисленными
заглушками; те же фазы 0–3, тот же `TestApp`. Каждый неудовлетворённый
импорт нужно заглушить явно. Ошибка перечисляет все недостающие токены и
потребителя каждого, а не первый попавшийся. `stubs` здесь означает
«дать недостающее», а не «заменить существующее»; в это же поле кладётся
`stub(Contract, impl)`. Опции: `stubs`, `config`, `transports`.

## Настройка раннера

Пакет опирается на условный subpath `@nestling/app/testing`. Раннер должен
включить условие `"testing"`:

```javascript
// jest
testEnvironmentOptions: { customExportConditions: ['testing', 'node', 'node-addons'] }

// vitest
resolve: { conditions: ['testing', 'node'] }
```

Пакету, который импортирует такой subpath при сборке, нужно
`customConditions: ['testing']` в `tsconfig.json` и
`lib: ['es2022', 'dom', 'dom.iterable', 'esnext.disposable']` для
`await using`.

## Справочник API

| Экспорт | Что это |
|---|---|
| `assembleTest(spec)` | тестовая сборка; возвращает `TestApp` |
| `testModule(module, options?)` | сборка вокруг одного модуля; возвращает `TestApp` |
| `TestApp` | `call`, `emit`, `get`, `pruned`, `stubbed`, `features`, `close`, `Symbol.asyncDispose` |
| `TestAssemblySpec`, `TestCallOptions`, `TestStub`, `EmitDelivery` | типы спека, опций вызова, заглушки и доставки |
| `stub(contract, impl)` | пара «токен вызывателя, заглушка» для `stubs:` |
| `ContractStub`, `RequestStubImpl`, `EmitStubImpl`, `StubOutput` | типы заглушек |
| `unwrap(response)`, `UnwrapFailedError` | значение успешного ответа или ошибка |
| `vars(record)`, `TestConfig` | источник конфига для тестов и тип поля `config:` |
| `familyOverride(family, make)`, `TestOverride` | подмена рецепта семейства |
| `contextValue(variable, value)` | подмена переменной контекста запроса |
| `checkTopologies(spec, selections, options?)`, `TopologyReport` | матрица `check()` |
| `CheckReport`, `CheckOptions` | реэкспорт типов из `@nestling/app` |
| `snapshotContracts`, `serializeSnapshot`, `diffContracts`, `formatCompatibility` | реэкспорт из `@nestling/ports`, чтобы CI-тест обходился одним импортом |
| `SchemaDocConverter` | тип конвертера схем (реэкспорт из `@nestling/pipeline`) |

## Границы пакета

Раннера, матчеров и snapshot-механики здесь нет. `app.port(Contract)` для
теста потребителя контракта не реализован; `.check()` подстановок не
принимает и всегда проверяет граф без них.
