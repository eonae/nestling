# @nestling/testing

Тестовый composition root. `assembleTest(app, options)` собирает ту же
декларацию `makeApp`, что запускает `main.ts`, проводит приложение по
фазам `0 BOOTSTRAP`, `1 ASSEMBLE`, `2 INIT`, `3 WIRE` и останавливается:
`dispatch` создан, сокеты не открыты, обработчики `SIGTERM`/`SIGINT` не
установлены, в stdout ничего не напечатано.

> 🚧 Активная разработка, API меняется. Целевой дизайн:
> [`docs/design/testing.md`](../../docs/design/testing.md).
> Гайд: [глава 7. Убедиться, что работает, без запуска сервера](../../docs/guide/07-testing.md).

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
import { app } from './app';   // та же декларация makeApp, что у main.ts

import { assembleTest, stub, unwrap, vars } from '@nestling/testing';

await using testApp = await assembleTest(app, {
  overrides: [[UsersRepository, inMemoryUsersRepo()]],
  // заглушка операции, которую эта сборка не реализует
  stubs: [stub(ChargeCard, async ({ amount }) => ({ chargeId: `c-${amount}` }))],
  config: vars({ USERS_PAGE_SIZE: '10' }),
});

expect(unwrap(await testApp.call(GetUser, { id: '1' }))).toEqual({ id: '1', name: 'Alice' });
```

Состав приложения — фичи, плагины, провайдеры, транспорты, интерком,
политики — берётся из декларации: словарь состава в тест не копируется, и
те же инварианты проверяются здесь, что и в production. В опциях остаются
выбор фич и подстановки.

| Опция | Что это |
|---|---|
| `select` | выбор фич в тех же формах, что у `app.assemble(select)` |
| `overrides` | подмена узлов графа: пары «токен и заглушка», рецепты семейств, переменные контекста |
| `stubs` | поставка недостающего: пары «токен и значение», заглушки операций |
| `config` | привязка источников конфига; **заменяет** привязку декларации целиком |

Список `transports` в опциях не принимается: тестовая сборка не выполняет
START, поэтому сокеты не открываются и подменять порт незачем.

`assembleTest` асинхронна, поэтому пишите `await using testApp = await
assembleTest(…)`: `await using` ждёт освобождения ресурса, а не
инициализатор. Форма без `using` тоже работает: `const testApp = await
assembleTest(…)` и `await testApp.close()` в `afterEach`. `close()`
идемпотентен. Переменная называется `testApp`, чтобы не затенять `app` из
`app.ts`.

## Что выполняется в тестовой сборке

| Выполняется | Не выполняется |
|---|---|
| выбор фич, регистрация, discovery, `build()` | `container.start()` и `@OnStart` |
| все проверки ASSEMBLE: транспорты, формы io, циклы, `policies` | `transport.serve(...)`: сокет не открывается |
| `@OnInit` в топологическом порядке | обработчики `SIGTERM`/`SIGINT` |
| WIRE: декларации получают зависимости, создаётся `dispatch` на транспорт | строка состава сборки в stdout |
| `testApp.call` и `testApp.emit` через полный пайплайн | сетевой уровень: разбор запроса, заголовки, сокеты |

**`@OnStart` в тесте не вызывается.** Всё, что провайдер открывает в
`@OnStart`, в тесте открыто не будет. Ресурсы, нужные и в тесте
(соединение с БД, клиент брокера), открывайте в `@OnInit`.

## `testApp.call`: запрос через полный пайплайн

```typescript
const res = await testApp.call(CreateUser, { name: 'Alice' });
// ResponseContext<User>: { isSuccess: true, status, value }
//                      | { isSuccess: false, status, value: { error, code, … } }
```

Это отличает app-тест от юнит-теста: все слои пайплайна, проверка входа по
схеме `input` и проверка задекларированных ошибок выполняются
по-настоящему. Вход проверяет тот же рантайм, что и при запросе по сети,
включая поля формы `multipart`, поэтому `testApp.call` и HTTP дают один
результат. Декларация
ищется по идентичности значения: тест держит то же значение, которое модуль
перечислил в `endpoints:`, и никаких строк не сравнивает. Декларация, не
входящая в приложение (модуль не зарегистрирован, фича не выбрана), даёт
ошибку со списком доступных endpoint'ов.

- Тип `input` берётся из формы `input` декларации, тип результата — из
  формы `output`. Ветка отказа несёт `code` из списка `errors:`, а
  `status` равен категории этого кода.
- `unwrap(res)` возвращает значение или бросает `UnwrapFailedError` с
  категорией и кодом. Это форма для случая «ожидаю успех».
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
`makeApp` его не принимает.

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
  `testApp.call` сервис прочитает то, что задал тест, а не то, что записал
  пайплайн. Без `contextValue` работает production-проекция: значение слоя
  внутри вызова, `undefined` из `peek()` снаружи.

Подмена отсекает поддерево, которое больше никому не нужно. Замените
репозиторий заглушкой, и пул `pg` не будет создан, не подключится и не
попадёт в граф. `testApp.pruned` перечисляет отсечённые идентификаторы;
`testApp.get(token)` возвращает для них `null`. Без `overrides` граф
совпадает с production-графом.

## `stub(Operation, impl)`: фича без соседей

Фича, которая инжектит `ChargeCard.caller`, не соберётся без соседа: рецепт
вызывателя не проходит проверку достижимости. `stub` возвращает пару
«токен вызывателя и заглушка»: `[C.caller, …]` для `request`-операции,
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
для заглушенной операции не вызывается, и проверка достижимости тоже.

Заглушка проверяется схемами своей операции при каждом вызове:

- вход разбирается формой `input` операции: неверный payload даёт
  `bad_request`, и `impl` не вызывается;
- успешный результат разбирается формой `output`: заглушка,
  разошедшаяся с операцией, даёт вызывающему отказ `bad_request`
  с путём до поля, а не неверное значение. Это строже production-порта
  внутри процесса: настоящий ответ уже прошёл пайплайн реализации, у
  заглушки пайплайна нет;
- возвращённый или брошенный отказ должен входить в `errors:` операции
  (плюс коды ядра `bad_request`, `internal_error`, `timeout`).
  Незадекларированный код — дефект теста, поэтому заглушка бросает ошибку с
  именем операции, кодом и разрешённым набором, а не превращает его в
  `InternalError`;
- исключение из `impl`, не являющееся `Fail`, пробрасывается как есть.

Параметры вызова тоже воспроизводятся: исчерпанный `meta.deadline` даёт
`timeout` до вызова `impl`, а `emit` команды всегда несёт
`idempotencyKey` — переданный вызывающим или сгенерированный заглушкой.

Место вызова совпадает с production (`Port<C>` / `Emitter<C>`, результат
`PortResult<C>`); заглушка, не подходящая операции, не компилируется.
Своего spy у пакета нет: `impl` — обычная функция, туда подходит
`jest.fn()`.

## `testApp.emit`: событие или команда снаружи

```typescript
const [{ subscriber, response }] = await testApp.emit(PlaceOrder, { orderId: 'o-1' });
```

`emit` доставляет событие или команду каждому подписчику в этом процессе,
каждому через его полный пайплайн, и возвращает их ответы вместе с именами
подписчиков (`EmitDelivery[]`).

- транспортные атрибуты несут параметры вызова, включая `idempotencyKey`;
- ноль подписчиков у `event` — допустимая рассылка и пустой список; у
  `command` — ошибка адресации со списком доступных subject'ов;
- `request`-операция не компилируется: у неё один владелец, а не
  подписчики;
- заглушенный эмиттер не мешает: заглушка подменяет то, что приложение
  вызывает наружу, а `emit` ведёт приложение снаружи внутрь.

## `checkTopologies`: матрица топологий

Подмены и заглушки делают тестовый граф меньше production-графа. Полный
граф без подстановок проверяет `app.check()` из
[`@nestling/app`](../nestling.app): фазы 0–1. Этот пакет оборачивает его в
матрицу:

```typescript
await checkTopologies(app, ['all', 'users', 'ops']);
```

`checkTopologies(app, selections, options?)` возвращает
`TopologyReport[]` — пары `{ select, report }`. Ядро останавливается на
первой ошибке; хелпер собирает ошибки всех топологий и бросает одно
сообщение с причиной по каждой.

Политики декларации проверяются в каждой топологии матрицы, поэтому
инвариант, который держится при выборе `'all'` и ломается на
подмножестве, ловится в CI. Причины `detached` приходят значениями в
отчёте, и тест сравнивает набор, а не разбирает stdout:

```typescript
const [{ report }] = await checkTopologies(app, ['all']);

expect(
  report.endpoints.filter(({ detached }) => detached !== undefined)
    .map(({ pattern }) => pattern),
).toEqual(['GET /health']);
```

### Совместимость операций

Отчёт каждой топологии содержит `operations` — дескрипторы операций,
которые топология публикует. Проверка совместимости строится на них без
второй сборки:

```typescript
import {
  checkTopologies, diffOperations, formatCompatibility, snapshotOperations,
} from '@nestling/testing';

const reports = await checkTopologies(app, ['all', 'users', 'ops'], {
  converters: [zodConverter()],
});

const report = diffOperations(readBaseline(), snapshotOperations(reports));

console.log(formatCompatibility(report));
expect(report.breaking).toEqual([]);
```

`options` передаются в `check()` каждой топологии. Без конвертеров
дескрипторы всё равно строятся: структурная часть (вид, формы io, коды и
категории отказов) точная, а листовые схемы помечаются непрозрачными, что даёт
вердикт `unknown`. `diffOperations` — чистая функция от двух значений; она
не участвует в сборке и не бросает ошибок по результату сравнения. Правила
вердиктов и ведение baseline описаны в
[`@nestling/ports`](../nestling.ports).

## `vars()`: конфиг из объекта

```typescript
const src = vars({ RUNTIME_LOG_LEVEL: 'info' });
await using testApp = await assembleTest(app, { config: src });

src.set('RUNTIME_LOG_LEVEL', 'debug'); // reloadable-секция перепроецируется
```

`vars(record)` возвращает именованный `ObjectSource` с методами `set`,
`assign` и `watch`. `process.env` не трогается, поэтому тесты изолированы
и могут идти параллельно, а механика перезагрузки конфига становится
проверяемой.

Поле `config:` тестового корня принимает три формы: источник (то же, что
`[[source, '*']]`), одну привязку или список привязок; `makeApp`
принимает только список привязок. Заданный конфиг **заменяет** привязку
декларации целиком: тест изолирован от источников приложения так же, как
от `process.env`.

## `testUnit`: одна фича или плагин отдельно

```typescript
await using testApp = await testUnit(ReportsFeature, {
  stubs: [
    [ILogger, noopLogger],
    [IClock, { now: () => 42 }],
    stub(ChargeCard, async () => ({ chargeId: 'c1' })),
  ],
  transports: [http({ port: 0 })],
});
```

`testUnit(unit, options?)` собирает мини-приложение вокруг одной фичи или
одного плагина — с её модулями и их `dependsOn`, модулем ядра для конфига
и перечисленными заглушками; те же фазы 0–3, тот же `TestApp`. Каждую
неудовлетворённую зависимость нужно заглушить явно. Ошибка перечисляет все недостающие токены и
потребителя каждого, а не первый попавшийся. `stubs` здесь означает
«дать недостающее», а не «заменить существующее»; в это же поле кладётся
`stub(Operation, impl)`. Опции: `stubs`, `config`, `transports`.

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
| `assembleTest(app, options?)` | тестовая сборка декларации; возвращает `TestApp` |
| `testUnit(module, options?)` | сборка вокруг одного модуля; возвращает `TestApp` |
| `TestApp` | `call`, `emit`, `get`, `pruned`, `stubbed`, `features`, `close`, `Symbol.asyncDispose` |
| `TestAssemblyOptions`, `TestCallOptions`, `TestStub`, `EmitDelivery` | типы опций сборки, опций вызова, заглушки и доставки |
| `stub(operation, impl)` | пара «токен вызывателя, заглушка» для `stubs:` |
| `OperationStub`, `RequestStubImpl`, `EmitStubImpl`, `StubOutput` | типы заглушек |
| `unwrap(response)`, `UnwrapFailedError` | значение успешного ответа или ошибка |
| `vars(record)`, `TestConfig` | источник конфига для тестов и тип поля `config:` |
| `familyOverride(family, make)`, `TestOverride` | подмена рецепта семейства |
| `contextValue(variable, value)` | подмена переменной контекста запроса |
| `checkTopologies(app, selections, options?)`, `TopologyReport` | матрица `check()` |
| `CheckReport`, `CheckOptions` | реэкспорт типов из `@nestling/app` |
| `snapshotOperations`, `serializeSnapshot`, `diffOperations`, `formatCompatibility` | реэкспорт из `@nestling/ports`, чтобы CI-тест обходился одним импортом |
| `SchemaDocConverter` | тип конвертера схем (реэкспорт из `@nestling/pipeline`) |

## Границы пакета

Раннера, матчеров и snapshot-механики здесь нет. `testApp.caller(Operation)`
для теста потребителя операции не реализован; `check()` подстановок не
принимает и всегда проверяет граф без них.
