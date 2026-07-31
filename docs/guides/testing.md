# Тестирование приложения: `assembleTest`, `.check()`, `./testing`

> Гайд по **текущему API**; сверено с кодом `examples.app-with-http` (2026-07-31).

Между юнитом и e2e была дыра: прогнать запрос через полный пайплайн, но без
сокета, было не через что. Её закрывает `@nestling/testing` — тестовый
composition root, который ведёт **то же самое** приложение по фазам 0–3 и
останавливается.

```typescript
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

## 1. Три уровня и граница между ними

| Уровень | Чем поднимается | Что проверяет | Чего не проверяет |
|---|---|---|---|
| **юнит** | `new UserService(logger, repo)` | доменную логику | ничего из фреймворка — у юнита нет импортов из `@nestling/*` |
| **app-тест** | `assembleTest({ … })` + `app.call` | сборку графа, **все слои пайплайна**, валидацию схем, страж границы, отказы с их `status`/`code` | провод: раскладку path/query/body, заголовки, сокет |
| **e2e** | `assemble({ … }).run()` + HTTP-клиент | всё вместе, включая провод | быстроту и изоляцию |

App-тест берёт готовый payload — транспортный биндинг он не выполняет
намеренно: сборка запроса из path/query/body проверяется e2e и юнит-тестами
bind-карты. Кадр запроса при этом честный, но пустой: слой видит
`raw.transport` и `raw.pattern` своей декларации, а `raw.attributes` — `{}`,
если тест не задал их через `options`.

## 2. Что происходит и чего не происходит

`assembleTest` проходит `0 BOOTSTRAP → 1 ASSEMBLE → 2 INIT → 3 WIRE`:

- **происходит**: резолв `select`, регистрация, дискавери, построение графа,
  все fail-fast'ы ASSEMBLE (транспорт под ручку, формы io, циклы),
  `@OnInit`, рождение `dispatch`;
- **не происходит**: `@OnStart`, `serve` (сокет не открывается), обработчики
  `SIGTERM`/`SIGINT`, печать состава сборки в stdout.

Отсюда следствие, которое стоит знать заранее: **ресурс, захваченный в
`@OnStart`, в app-тесте не захватывается**. Это цена фазовой модели, а не
дефект: `@OnStart` — хук go-live, а тестовый прогон в эфир не выходит. Всё,
что нужно тесту, захватывается в `@OnInit` — что фазовая модель и предписывает.

`assembleTest` асинхронна, поэтому канон записи — `await using app = await
assembleTest(…)`: `await using` ждёт dispose, а не инициализатор. Форма без
`using` тоже работает:

```typescript
let app: TestApp;
beforeEach(async () => { app = await assembleTest({ … }); });
afterEach(async () => { await app.close(); });   // повторный close() безопасен
```

## 3. `overrides` + прунинг

Подстановка — это замена узла графа **до инстанциации**, а не патчинг
модулей и не перехват `import`:

```typescript
overrides: [
  [UsersRepository, inMemoryUsersRepo()],       // пара «токен → фейк»
  familyOverride(ILogger, () => noopLogger),    // рецепт семейства целиком
  contextValue(RequestId, 'req-1'),             // ambient-переменная запроса
]
```

- пара типизирована: фейк, не совместимый с типом токена, — ошибка
  компиляции;
- override токена, которого нет в графе, — ошибка сборки. Переименовали
  провайдер — тест падает, а не мокает молча пустоту;
- два override'а одного токена — ошибка;
- строковой формы (`overrideByName('…')`) нет: мокаешь то, на что у теста
  есть ссылка;
- `contextValue(Var, value)` — тот же список: ридер ambient-переменной
  ([http-app-di.md](./http-app-di.md), «Ambient-контекст») — обычный узел
  графа, и подменяется он как обычный узел. Подставленное значение читается
  **без запроса**: сервис можно позвать напрямую, ALS для этого не нужен, а
  на `app.call` подмена сильнее того, что положил пайплайн. Не подменил —
  видишь боевую проекцию: внутри вызова значение слоя, вне вызова `peek()`
  даёт `undefined`.

Заменили узел — его осиротевшее поддерево выпадает из графа. В примере
`UsersRepository` был единственным потребителем `UsersStore`, поэтому
соединение не открывается вовсе:

```typescript
expect(app.pruned).toContain('UsersStore');
expect(app.get(UsersStore)).toBeNull();
```

Без `overrides` прунинг **тождественен**: `app.pruned` пуст, граф ровно тот
же, что в бою.

## 4. Правило: мокаешь — проверь топологию

Прунинг делает граф теста уже боевого — это его смысл и его цена. Цену
компенсирует `.check()`: структурная проверка на **честном** графе, без
подстановок.

```typescript
import { checkTopologies } from '@nestling/testing';

await checkTopologies(
  { features: [UsersFeature, OpsFeature, QuotasFeature], transports: [http({ port: 0 })] },
  ['all', 'users', 'ops'],
);
```

`check()` гоняет фазы 0–1: конструкторы выполняются, `@OnInit` — нет, значит
ресурсы не захватываются, а каждая топология деплоя проверяется в CI без
деплоя. `checkTopologies` собирает **все** отказы и падает одним сообщением,
называя топологию для каждого; отчёты по успешным — обычное значение
(`features`, `endpoints`, `transports`), которое можно проверить ассертом.

Инварианты сборки едут сюда же: `spec` с полем `policies:` проверяется в
**каждой** топологии матрицы, поэтому нарушение, возникающее только на
подмножестве фич, ловится до деплоя (`policies:` принимает и `assembleTest`
— тестовый корень инварианты не ослабляет, см.
[гайд по композиции](./composition.md)). Причины `detached` приезжают в
отчёте значением, поэтому состав выведенных из-под политик ручек
сравнивается ассертом, а не парсингом вывода:

```typescript
// packages/examples.app-with-http/src/app.spec.ts
const [{ report }] = await checkTopologies(spec, ['all']);

expect(
  report.endpoints
    .filter(({ detached }) => detached !== undefined)
    .map(({ pattern }) => pattern),
).toEqual(['GET /health']);
```

Ограничение: конструктор с побочкой ломает `.check()`. Это и так нарушение
фазовой модели — ресурсы захватываются в `@OnInit`.

## 5. Конфиг тестом, а не окружением

`vars({ … })` — объектный `ConfigSource`; `process.env` не трогается, поэтому
тесты изолированы и параллелимы бесплатно.

```typescript
const src = vars({ RUNTIME_LOG_LEVEL: 'info' });

await using app = await assembleTest({ …, config: src });

src.set('RUNTIME_LOG_LEVEL', 'debug');   // reloadable-секция перепроецируется
```

Поле `config:` тестового корня принимает три формы: источник (сахар для
`[[source, '*']]`), одну привязку и список привязок. В боевом `assemble`
сахара нет — там привязка есть акт с приоритетами.

## 6. `./testing`-subpath: курируемая тестовая поверхность

Токены, разрешённые к подмене, и готовые фейки экспортируются отдельным
subpath'ом под условием `"testing"`:

```jsonc
// package.json модуля
"exports": {
  ".":         "./dist/index.js",
  "./testing": { "testing": "./dist/testing/index.js" }
}
```

Условие включено только в тест-раннере, поэтому прод-импорт не резолвится
**на уровне Node** — граница структурная, а не конвенция. Внутри subpath'а
живёт то, что автор держит в контракте с реализацией: в примере это токен
`UsersRepository` и фейк `inMemoryUsersRepo()`, которым пользуются и
app-тесты, и юнит-тест `UserService`. Ядро следует той же конвенции: шов,
которым `@nestling/testing` заводит фазы 0–3, живёт в `@nestling/app/testing`.

**jest** — условие включается в конфигурации тестов:

```javascript
testEnvironmentOptions: {
  customExportConditions: ['testing', 'node', 'node-addons'],
},
```

**vitest** — то же самое пишется как `resolve.conditions`:

```javascript
export default defineConfig({
  resolve: { conditions: ['testing', 'node'] },
});
```

Пакету, который импортирует такой subpath при сборке (а не только в тестах),
нужен `customConditions: ['testing']` в `tsconfig.json` — иначе typecheck
не найдёт модуль. Для `await using` там же понадобится
`lib: ['es2022', 'dom', 'dom.iterable', 'esnext.disposable']`.

## 7. Модуль в изоляции

```typescript
await using app = await testModule(ReportsModule, {
  stubs: [
    [ILogger, noopLogger],
    [IClock, { now: () => 42 }],
  ],
  transports: [http({ port: 0 })],
});
```

`testModule` поднимает мини-приложение вокруг одного модуля (с его
`imports`) и kernel-модуля конфига. Каждый неудовлетворённый импорт обязан
быть застабан явно; забыли — ошибка перечисляет **все** недостающие токены
с потребителем каждого:

```
Unsatisfied dependencies (2):
  - 'IsolatedClock' required by 'ReportService'
  - 'IsolatedUsers' required by 'ReportService'
```

Та же диагностика работает и на боевой сборке: `assemble`, который разъехался
по зависимостям, теперь называет все дыры сразу.

## 8. Чего в пакете нет

Ни своего `describe`, ни матчеров, ни snapshot-механики — jest остаётся
jest'ом. Не завезены и `stub(Contract, impl)` с `app.emit`: контрактов
(`makeContract`) в V1 ещё нет, поэтому поле `stubs:` пока принимает обычные
пары «токен → значение» — «поставка недостающего», а не подмена.
