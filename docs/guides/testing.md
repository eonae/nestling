# Тестирование приложения: `assembleTest`, `.check()`, `./testing`

> Гайд по **текущему API**; сверено с кодом `examples.app-with-http` (2026-09-02).
> Раздел 4 сверен с тестом изоляции фичи в `examples.split-nats`.

`@nestling/testing` — тестовый composition root. Он собирает то же
приложение, что и `assemble`, проводит его по фазам от `0 BOOTSTRAP` до
`3 WIRE` и останавливается: транспорты не запускаются, сокет не
открывается. Такой тест прогоняет запрос через полный пайплайн и занимает
место между юнит-тестом и e2e.

```typescript
// packages/examples.app-with-http/src/app.spec.ts
import { assembleTest, unwrap, vars } from '@nestling/testing';

await using app = await assembleTest({
  features: [UsersFeature, OpsFeature, QuotasFeature],
  transports: [http({ port: 0 })],
  overrides: [[UsersRepository, inMemoryUsersRepo()]],
  config: vars({ HTTP_PORT: '0' }),
});

expect(unwrap(await app.call(GetUser, { id: '1' }))).toEqual({
  id: '1',
  name: 'Alice',
  email: 'alice@example.com',
});
```

## 1. Три уровня тестов

| Уровень | Как поднимается | Что проверяет | Чего не проверяет |
|---|---|---|---|
| юнит | `new UserService(logger, inMemoryUsersRepo())` | доменную логику | ничего из фреймворка: у юнита нет импортов из `@nestling/*` |
| app-тест | `assembleTest({ … })` и `app.call` | сборку графа, все слои пайплайна, валидацию схем, проверку ответа по `errors`, отказы с их `status` и `code` | HTTP-уровень: раскладку path/query/body, заголовки, сокет |
| e2e | `assemble({ … }).run()` и HTTP-клиент | всё вместе, включая HTTP-уровень | скорость и изоляцию |

App-тест принимает готовый payload, а не HTTP-запрос: раскладка полей по
path, query и body в нём не выполняется. Её проверяют e2e-тесты и
юнит-тесты bind-карты. Кадр запроса при этом настоящий, но пустой: слой
пайплайна видит `raw.transport` и `raw.pattern` из декларации endpoint'а,
а `raw.attributes` равен `{}`, пока тест не задал их через `options`.

## 2. Какие фазы проходит тест

`assembleTest` проходит фазы `0 BOOTSTRAP`, `1 ASSEMBLE`, `2 INIT` и
`3 WIRE`:

- выполняются: разбор `select`, регистрация модулей, discovery, построение
  графа, все проверки фазы ASSEMBLE (транспорт под каждый endpoint, формы
  io, циклы), `@OnInit`, создание `dispatch`;
- не выполняются: `@OnStart`, `serve` (сокет не открывается), обработчики
  `SIGTERM` и `SIGINT`, печать состава сборки в stdout.

Отсюда важное следствие: **`@OnStart` в app-тесте не вызывается.** Всё,
что провайдер открывает в `@OnStart`, в тесте открыто не будет. Это
ожидаемо: `@OnStart` предназначен для начала приёма запросов, а тест
запросы через транспорт не принимает. Ресурсы, которые нужны и в тесте,
открывайте в `@OnInit`.

`assembleTest` асинхронна, поэтому пишите `await using app = await
assembleTest(…)`: `await using` ждёт освобождения ресурса при выходе из
блока, а не результата инициализации. Форма без `using` тоже работает:

```typescript
let app: TestApp;
beforeEach(async () => { app = await assembleTest({ … }); });
afterEach(async () => { await app.close(); });   // повторный close() безопасен
```

## 3. `overrides`: замена узла графа

Override заменяет узел графа до того, как контейнер создаст инстансы.
Модули не патчатся, `import` не перехватывается.

```typescript
overrides: [
  [UsersRepository, inMemoryUsersRepo()],       // пара «токен → фейк»
  familyOverride(ILogger, () => noopLogger),    // рецепт семейства целиком
  contextValue(RequestId, 'req-1'),             // контекстная переменная запроса
]
```

- Пара типизирована: фейк, не совместимый с типом токена, не компилируется.
- Override токена, которого нет в графе, — ошибка сборки. Если провайдер
  переименовали, тест упадёт, а не подменит молча пустоту.
- Два override'а одного токена — ошибка.
- Подменить можно только токен, на который у теста есть ссылка. Строковой
  формы вида `overrideByName('…')` нет.
- `contextValue(Var, value)` подменяет ридер контекстной переменной
  (см. [http-app-di.md](./http-app-di.md), раздел «Ambient-контекст»).
  Ридер — обычный узел графа, поэтому и подменяется как узел.
  Подставленное значение читается и вне запроса: сервис можно вызвать
  напрямую, без `app.call`. Внутри `app.call` подмена сильнее значения,
  которое положил пайплайн. Без подмены ридер ведёт себя как в бою: внутри
  вызова возвращает значение слоя, вне вызова `peek()` даёт `undefined`.

После замены узла его осиротевшее поддерево выпадает из графа. В примере
единственным потребителем `UsersStore` был `UsersRepository`; после его
замены соединение с хранилищем не открывается вовсе:

```typescript
// packages/examples.app-with-http/src/app.spec.ts
expect(app.pruned).toContain('UsersStore');
expect(app.get(HttpTransport$('default'))).not.toBeNull();
```

`app.pruned` — список id выпавших узлов. `app.get(token)` возвращает
`null`, если узла в графе нет. Без `overrides` граф совпадает с боевым, и
`app.pruned` пуст.

## 4. Фича без соседей: `stub(Operation, impl)` и `app.emit`

Фича, которая инжектит `ClaimQuota.caller`, без соседа не соберётся:
контейнер проверяет, что у операции есть реализация в этой сборке или
шина, доставляющая вызов наружу. Подключать соседнюю фичу в тест целиком
не нужно. Вместо неё ставится фейк-вызыватель:

```typescript
// packages/examples.split-nats/src/isolated.spec.ts
await using app = await assembleTest({
  features: [OrdersFeature, QuotasFeature],
  select: 'orders',
  stubs: [
    stub(ClaimQuota, async (input) => ({ granted: input.amount })),
    stub(OrderPlaced, (input) => {
      placed.push(input);
    }),
  ],
  overrides: [contextValue(TenantId, 'acme')],
});
```

`stub(C, impl)` возвращает пару «токен вызывателя → фейк»: `[C.caller, …]`
для `request`-операции и `[C.emitter, …]` для `command` и `event`.
Сторону выбирает вид операции. Пара передаётся в `stubs:` наравне с
обычными парами «токен → значение»; отдельного поля для стабов операций
нет.

Механизм простой: явный провайдер члена семейства имеет приоритет над
рецептом семейства. Поэтому для застабанного операции боевой вызыватель
не строится, и проверка достижимости не выполняется.

**Фейк проверяется схемами своего операции при каждом вызове.**

- Вход разбирается схемой `input`. Невалидный payload даёт
  `VALIDATION_FAILED`, и `impl` не вызывается.
- Успешный результат разбирается схемой `output`. Фейк, вернувший
  `{ grantedAmount: 1 }` вместо `{ granted: 1 }`, роняет тест на самом
  стабе, а не на потребителе. Здесь стаб строже боевого порта: у боевого
  ответа за спиной пайплайн реализации с валидацией, у стаба его нет.
- Отказ обязан входить в `errors:` операции или быть одним из kernel-кодов
  (`VALIDATION_FAILED`, `UNKNOWN`, `DEADLINE_EXCEEDED`). Отказ с другим
  кодом — дефект теста: стаб бросает ошибку с именем операции, полученным
  кодом и списком допустимых, а не превращает его в `UnknownError`.
- Исключение, которое не является `Fail`, пробрасывается как есть.
  Падение фейка не должно выглядеть как ответ `UNKNOWN` от соседа.

Стаб воспроизводит и эксплуатационное поведение вызывателя: исчерпанный
`meta.deadline` даёт `DEADLINE_EXCEEDED` до вызова фейка, а `emit`
команды всегда получает `idempotencyKey` — переданный или сгенерированный
стабом. Тесты на дедлайны и идемпотентность проходят со стабом так же, как
в бою.

Место вызова не меняется: значение стаба имеет тип `Port<C>` или
`Emitter<C>`, результат — `PortResult<C>`. Несовместимый фейк — ошибка
компиляции в точке `stub(...)`. `impl` пишется как обычный хендлер:
возвращает голое значение, `new Ok(value)` или объявленный отказ. Своего
spy у стаба нет: `jest.fn()` в позиции `impl` работает как есть.

### `app.emit`: вызов подписчиков снаружи

Стаб заменяет то, что приложение вызывает наружу. Обратное направление —
`app.emit(Operation, payload, meta?)`: он доставляет событие или команду
всем подписчикам в этой сборке, каждому через его полный пайплайн, как
это сделал бы издатель.

```typescript
// packages/examples.split-nats/src/isolated.spec.ts
const [{ subscriber, response }] = await app.emit(PlaceOrder, {
  orderId: 'o-1',
  amount: 10,
});
```

- Возвращается список ответов подписчиков с именем каждого:
  `{ subscriber, response }[]`. Боевой эмиттер возвращает `Promise<void>`,
  потому что издатель за обработку не отвечает. Тест отвечает именно за
  неё, и без ответа проверка подписчика превратилась бы в гонку. Ждать
  здесь безопасно: сокета нет, все подписчики в том же процессе.
- Транспортные атрибуты кадра несут профиль вызова, включая
  `idempotencyKey` у `command`. Обработчик видит то же, что увидел бы в
  бою.
- `event` без подписчиков допустим: возвращается пустой список. `command`
  без владельца — ошибка с перечнем доступных subject'ов.
- `request`-операция передать нельзя: это ошибка компиляции. У `request`
  не подписчики, а один владелец, который отвечает вызывающему. Для него
  есть `app.call`.
- Стаб эмиттера доставке не мешает: одно направление не отменяет другого.

## 5. Правило: подменили — проверьте топологию

Прунинг делает граф теста меньше боевого, а стаб подменяет реализацию
операции. Это их назначение, но из-за них app-тест не доказывает, что
боевая сборка вообще собирается. Это доказывает `.check()`: структурная
проверка графа без подстановок.

```typescript
import { checkTopologies } from '@nestling/testing';

await checkTopologies(
  { features: [UsersFeature, OpsFeature, QuotasFeature], transports: [http({ port: 0 })] },
  ['all', 'users', 'ops'],
);
```

`check()` проходит фазы 0–1: конструкторы выполняются, `@OnInit` — нет.
Ресурсы не открываются, поэтому каждую топологию деплоя можно проверить в
CI без деплоя. `checkTopologies` собирает все отказы и падает одним
сообщением с именем каждой несобравшейся топологии. Отчёты успешных
топологий — обычные значения (`features`, `endpoints`, `transports`,
`operations`), их можно проверять через `expect`.

Инварианты сборки проверяются здесь же: если в `spec` есть `policies:`,
они проверяются в каждой топологии матрицы. Нарушение, которое возникает
только на подмножестве фич, ловится до деплоя. `assembleTest` тоже
принимает `policies:` и не ослабляет их (см. [гайд по
композиции](./composition.md)). Причины `detached` приходят в отчёте
значением, поэтому состав endpoint'ов, выведенных из-под политик,
сравнивается через `expect`, а не разбором вывода:

```typescript
// packages/examples.app-with-http/src/app.spec.ts
const [{ report }] = await checkTopologies(spec, ['all']);

expect(
  report.endpoints
    .filter(({ detached }) => detached !== undefined)
    .map(({ pattern, detached }) => ({ pattern, detached })),
).toEqual([
  {
    pattern: 'GET /health',
    detached:
      'liveness-проба балансировщика: строка аудита на каждый удар — шум, а не наблюдаемость',
  },
]);
```

Ограничение: конструктор с побочным эффектом ломает `.check()`. Это и так
нарушение фазовой модели: ресурсы открываются в `@OnInit`, а не в
конструкторе.

### Сверка стабов с матрицей

`app.stubbed` — имена застабанных операций по алфавиту, симметрично
`app.pruned`. `report.operations` каждой топологии — дескрипторы операций,
которые она публикует. Сравнение этих двух списков — машинная форма
правила: стаб, который прикрывает операция без реализации ни в одной
топологии, становится виден в CI.

```typescript
// packages/examples.split-nats/src/isolated.spec.ts
const topologies = await checkTopologies(honestSpec, ['all', 'orders', 'quotas']);

const published = new Set(
  topologies.flatMap(({ report }) => report.operations.map(({ name }) => name)),
);

expect(app.stubbed.filter((name) => !published.has(name))).toEqual([]);
```

Отдельного хелпера для этой проверки в пакете нет: обе стороны уже
значения.

### Отчёт совместимости операций

Отчёт каждой топологии содержит поле `operations` — дескрипторы
операций, которые эта топология публикует. Поэтому проверка «не сломал
ли я операция соседней фичи» пишется одним импортом и без пересборки
приложения:

```typescript
// packages/examples.app-with-http/src/operations.compat.spec.ts
import {
  checkTopologies,
  diffOperations,
  formatCompatibility,
  snapshotOperations,
} from '@nestling/testing';

const reports = await checkTopologies(spec, ['all', 'users', 'ops'], {
  converters: [zodConverter()],
});

const report = diffOperations(readBaseline(), snapshotOperations(reports));

console.log(formatCompatibility(report));
expect(report.breaking).toEqual([]);
```

`checkTopologies` передаёт `options` в `check()` каждой топологии; вызов
из двух аргументов работает как прежде. Без конвертеров дескрипторы тоже
строятся: структурная часть (вид операции, формы io, коды и статусы
отказов) точна, а листовые схемы помечаются непрозрачными и получают
вердикт `unknown`.

Матрица сводится объединением: операция, который публикует только
топология `all`, в снапшоте есть и знает, кто его опубликовал. Иначе фича,
не выбранная в топологии `ops`, выглядела бы как удалённый операция.

Падает здесь только `expect` теста: `diffOperations` — чистая функция двух
значений, в сборке она не участвует и сама не бросает. Правила вердиктов
и обновление baseline описаны в [гайде по портам](./ports.md).

## 6. Конфиг из теста

`vars({ … })` — объектный `ConfigSource`. `process.env` не читается и не
меняется, поэтому тесты изолированы и могут идти параллельно.

```typescript
const src = vars({ RUNTIME_LOG_LEVEL: 'info' });

await using app = await assembleTest({ …, config: src });

src.set('RUNTIME_LOG_LEVEL', 'debug');   // reloadable-секция получит новое значение
```

Поле `config:` тестового корня принимает три формы: источник (то же, что
`[[source, '*']]`), одну привязку и список привязок. Боевой `assemble`
голый источник не принимает: там привязка задаёт приоритеты явно.

## 7. Subpath `./testing`: тестовая поверхность модуля

Токены, разрешённые к подмене, и готовые фейки экспортируются отдельным
subpath'ом под условием `"testing"`:

```jsonc
// packages/examples.app-with-http/package.json
"exports": {
  ".": "./dist/bundle.js",
  "./testing": { "testing": "./src/testing/index.ts" }
}
```

Условие включено только в тест-раннере, поэтому импорт
`examples.app-with-http/testing` из прод-кода не резолвится на уровне
Node. У публикуемого пакета путь ведёт в `dist/`. В subpath'е лежит то,
что автор модуля держит в операции с реализацией: в примере это токен
`UsersRepository` и фейк `inMemoryUsersRepo()`. Ими пользуются и
app-тесты, и юнит-тест `UserService`. Ядро устроено так же: точка входа,
через которую `@nestling/testing` проводит фазы 0–3, живёт в
`@nestling/app/testing`.

Для **jest** условие включается в конфигурации тестов:

```javascript
// jest.config.base.js
testEnvironmentOptions: {
  customExportConditions: ['testing', 'node', 'node-addons'],
},
```

Для **vitest** то же самое пишется как `resolve.conditions`:

```javascript
export default defineConfig({
  resolve: { conditions: ['testing', 'node'] },
});
```

Пакету, который импортирует такой subpath при сборке, а не только в
тестах, нужен `customConditions: ['testing']` в `tsconfig.json` — иначе
typecheck не найдёт модуль. Для `await using` там же понадобится
`lib: ['es2022', 'dom', 'dom.iterable', 'esnext.disposable']`.

## 8. Модуль в изоляции: `testUnit`

```typescript
await using app = await testUnit(ReportsModule, {
  stubs: [
    [ILogger, noopLogger],
    [IClock, { now: () => 42 }],
    stub(ChargeCard, async () => ({ chargeId: 'c1' })),
  ],
  transports: [http({ port: 0 })],
});
```

`testUnit` поднимает мини-приложение из одного модуля с её модулями и
kernel-модуля конфига. Поле `stubs` то же, что у `assembleTest`:
вызов операции, объявленный единицей, поставляется им наравне с
недостающим провайдером. Каждый неудовлетворённый импорт нужно застабать
явно. Если что-то забыто, ошибка перечисляет все недостающие токены с
потребителем каждого:

```
Unsatisfied dependencies (2):
  - 'IsolatedClock' required by 'ReportService'
  - 'IsolatedUsers' required by 'ReportService'
```

Та же диагностика работает и в боевом `assemble`: он называет все
недостающие зависимости сразу.

## 9. Границы пакета

Пакет не вводит своего `describe`, матчеров и snapshot-механики: раннер
остаётся jest. У стаба нет своего spy: `impl` — обычная функция, и в её
позиции работает `jest.fn()`. `app.caller(Operation)` — типизированный порт
для теста потребителя — не реализован; вопрос открыт в [журнале
решений](../decisions/ideas.md). `.check()` не принимает подстановок: он
всегда проверяет граф без них.
