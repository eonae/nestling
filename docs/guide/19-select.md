# 19. Запускать только часть фич

> Гайд по текущему API; сверено с кодом `0f401ce1`.
> Целевое описание: [design/composition.md](../design/composition.md)
> «L2 — фичи, выбор и переключатели» и «`check()`». Почему так: записи
> [ideas.md](../decisions/ideas.md) «[2026-07-08] Модульный монолит: фичи,
> `select`», «[2026-09-02] Модель композиции: фича, плагин, операция» и
> «[2026-09-06] Переключатели состава: `makeSwitch`, `pick` и `when`,
> аргумент сборки; формы корня без фич».

Приложение состоит из фич `users`, `notifications` и `ops`. Локально оно
запускается одним процессом. В проде пользовательский API и служебные
endpoint'ы разворачиваются отдельно, и каждый процесс должен поднимать
только свои фичи. Один и тот же код должен собираться во все три роли, а
неверный состав должен останавливать сборку, а не первый запрос.

## Передайте командную строку аргументом сборки

```typescript
// src/main.ts
import { app } from './app.js';

import { argv } from '@nestlingjs/app';

/**
 * Точка входа. `--features users` поднимает фичу пользователей,
 * `--features all` — все, `--include-deps` добирает те, чьи операции
 * выбранные вызывают, `--docs off` убирает документацию из состава.
 */
await app.build(argv(process.argv)).run();
```

`argv(process.argv)` — маркер: он несёт список строк и ничего не
разбирает. Схему флагов знает декларация, и разбирает их сборка. Ядро
`process.argv` не читает: список передаёт точка входа.

Список принимается целиком, вместе с путём к исполняемому файлу и путём
к скрипту: первые два элемента отбрасывает разбор, а второй нужен ему
для строки вызова в справке. Срезанный список (`process.argv.slice(2)`)
отвергается — иначе разбор потерял бы два первых флага, и процесс
поднялся бы другим составом.

Конфигурация состав не задаёт: секции корня с ключами вида
`APP_FEATURES` больше нет, и окружение на выбор фич не влияет.

## Схема флагов и формы аргумента

Схема выводится из декларации целиком:

| Флаг | Значение |
|---|---|
| `--features` | `all` либо имена через запятую: `--features users,ops` |
| `--include-deps` | без значения: замкнуть выбор по вызываемым операциям |
| `--<имя переключателя>` | одно из значений `makeSwitch`: `--docs off` |
| `--help` | без значения: печатает схему и завершает процесс кодом `0` |

Значение пишется двумя способами: `--docs off` и `--docs=off`. Коротких
флагов, группировки и позиционных аргументов нет.

Вторая форма аргумента — объект; ею пользуются тесты и приложение со
своим разбором командной строки:

| Запись | Что выбирает |
|---|---|
| `{ features: 'all' }` | все фичи из `features:` |
| `{ features: 'users,ops' }` | фичи по именам; пробелы вокруг имён игнорируются |
| `{ features: ['users', 'ops'] }` | то же списком |
| `{ features, includeDeps: true }` | фичи по именам плюс фичи, чьи операции они вызывают |
| `{ features, docs: 'off' }` | те же фичи плюс значения переключателей |

Если `features:` заданы, а выбор нет, выбраны все фичи. Плагины из
`plugins:` в выбор не входят: они есть в каждом процессе. Невыбранная
фича отсутствует в процессе целиком: её провайдеры не создаются, её
endpoint'ы не регистрируются, её реализации операций не подписываются.
Неизвестное имя фичи останавливает сборку, и ошибка перечисляет
доступные, так же как две фичи с одним именем, пустой выбор и выбор без
`features:`.

Разбор командной строки строгий и отказывает до фазы 0: неизвестный флаг
перечисляет известные, значение вне словаря переключателя — допустимые,
флаг без значения — значения своего переключателя, позиционный аргумент
называется в сообщении. Переключатель без умолчания требует флага.

```bash
API_TOKEN=secret WEBHOOK_SECRET=hook yarn start:dev --features users --include-deps
```

```
[nestling] features: users, notifications; docs=on; transports: http, mcp, bus
[nestling] selection closed over calls: users + notifications
[nestling] detached from policies: POST /hooks/users (http) — webhook: подлинность проверяется подписью тела, а не Bearer-токеном
```

Выбрана одна фича, а в процессе две. `includeDeps: true` замыкает выбор
по вызываемым операциям: фича `users` инжектит `CheckAddress.caller` и
`ForgetAddress.emitter`, владелец обеих операций живёт в `notifications`, и
она подключается сама. Вторая строка вывода показывает, что добавило
замыкание.

Вызовом считается упоминание `.caller` или `.emitter` в зависимостях
класса-хендлера или любого другого провайдера. Замыкание идёт по `request` и
`command`: у них ровно один владелец. События в замыкании не участвуют.
У события может не быть ни одного подписчика, и процесс без подписчика
на `users.registered` остаётся правильной топологией.

Фича `ops` не подключается: её операции никто не вызывает, и она
приходит только явным выбором.

```
[nestling] features: ops; docs=on; transports: http, mcp, bus
[nestling] selection closed over calls: ops (nothing added)
```

Сборка с выбором `'users'` без `includeDeps` останавливается на фазе
BUILD:

```
Operation 'notifications.check-address' (kind 'request') is injected as '.caller', but no
selected feature implements it and this build has no intercom, so the
call has nowhere to go. Either add the feature that implements it to the
build argument (or close the selection over calls with
'build({ features, includeDeps: true })'), or assign the intercom role
to a bus transport ('transports: [nats({ name: "events" })]' with
'intercom: "events"') when the owner lives in another process.
```

Ошибка называет операцию, вызывателя и два способа починить: включить
владельца в выбор или назначить интерком, когда владелец работает в
другом процессе.

## Переключатели: второе измерение состава

Выбор фич отвечает, какие области поднимает процесс. Переключатель
отвечает, какой из вариантов одной и той же области. Документация нужна в
dev-контуре и не нужна за периметром, и это не повод заводить фичу ради
одного плагина.

```typescript
// src/app.ts
export const DocsEnabled = makeSwitch('docs', { default: 'on' });

export const app = makeApp({
  features: [UsersFeature, NotificationsFeature, OpsFeature],
  plugins: [
    observability,
    auth,
    subscriptions,
    // При `docs=off` плагина в сборке нет целиком
    DocsEnabled.when(openapi),
  ],
  switches: [DocsEnabled],
  // Два протокола на одном сокете: рецепт
  // [«Отдать операции агенту по MCP»](../recipes/mcp.md)
  transports: [http({ server: api }), mcp({ … })],
});
```

`makeSwitch('docs', { default: 'on' })` объявляет двухпозиционный
переключатель со значениями `'on'` и `'off'`. У перечисления форма другая:
`makeSwitch('storage', ['s3', 'local'])`, и ветка объявляется таблицей
`Storage.pick({ s3: [...], local: [...] })`, которая обязана перечислить
все значения. `when(x)` — сокращение `pick({ on: x, off: [] })`.

Ветка — значение, а не функция: состав обеих веток читается без
выполнения кода. Поэтому `check()` видит обе, и человек, читающий `app.ts`,
тоже.

Ветка стоит в любом списке единиц: `providers:` и `dependsOn:` модуля,
`modules:` и `endpoints:` фичи и плагина, `endpoints:`, `providers:`,
`modules:`, `plugins:` и `transports:` корня. В `features:` её нет: состав
фич выбирает аргумент сборки. В `policies:` её нет: инвариант либо
объявлен, либо нет.

Словарь `switches:` объявляет корень, и из него выводится и тип объектной
формы аргумента, и схема флагов командной строки. Поле переключателя с
умолчанием необязательно, без умолчания обязательно, значение вне словаря
не компилируется:

```typescript
app.build({ features: 'all', docs: 'off' }); // ок
app.build({ features: 'all', doc: 'off' }); // не компилируется: поля нет
app.build({ features: 'all', docs: 'no' }); // не компилируется: нет значения
```

Те же четыре проверки повторяет рантайм на фазе BUILD — для
JS-потребителей и для значений, пришедших командной строкой: значение не
из словаря, `pick` на переключателе вне `switches:`, два переключателя с
одним именем, значение без умолчания не передано. Маркеру `argv` эти
проверки достаются целиком: содержимое командной строки известно в
работе, а не при компиляции.

Имена `features`, `includeDeps`, `include-deps` и `help` заняты
аргументом сборки: переключатель с таким именем отвергается при создании
декларации.

DI-токена у переключателя нет: инжектировать выбор нельзя. Состав не
протекает в код приложения, поэтому провайдер не может вести себя
по-разному «в зависимости от того, как собрано» — вместо этого его
попросту нет в графе.

Выбор виден в строке старта рядом с фичами:

```
[nestling] features: users, notifications; docs=off; transports: http, mcp, bus
```

и в отчёте `check()` полем `switches`.

## Плагины и проверка каждой роли без сокетов

```typescript
// src/app.spec.ts
  it('подключает плагины и только выбранную фичу', async () => {
    // `ops` выбрана одна: провайдеров фичи `users` в графе нет, а плагины
    // есть в любой сборке
    await using testApp = await buildTest(app, {
      config: testConfig,
      args: 'ops',
    });

    expect(testApp.get(AuditOutcome)).not.toBeNull();
    expect(testApp.get(SubscriptionRegistry)).not.toBeNull();
    expect(testApp.get(ActivityHub)).toBeNull();
  });
```

Наблюдаемость, аутентификация и реестр подписок подключены через
`plugins:` и от выбора фич не зависят. Провайдеров фичи `users` в этой
сборке нет.

```typescript
// src/app.spec.ts
const checked = makeApp({
  features: app.spec.features,
  plugins: app.spec.plugins,
  switches: app.spec.switches,
  policies: app.spec.policies,
  transports: app.spec.transports,
});

/**
 * Опции `check()`: подстановок у структурной проверки нет, поэтому
 * значения секретов привязываются источником к ключам секции
 */
const CHECK_OPTIONS = { config: [bind(vars(testEnv), { keys: appConfigKeys })] };
```

`check()` у приложения выполняет фазы 0 и 1: разбор аргумента сборки,
раскрытие веток переключателей, регистрацию, discovery, `build()`,
проверку достижимости вызываемых операций и проверку политик. Ни один
конструктор не
выполняется, `acquire`, `@OnStart` и `serve` не вызываются, ресурсы не
захватываются. Он бросает те же ошибки, что
бросил бы `run()` на фазах 0 и 1, и не влияет на последующий `run()` того
же приложения. `checkTopologies(app, topologies)` из `@nestlingjs/testing`
вызывает `check()` для каждого аргумента сборки и собирает ошибки всех
вариантов в одно сообщение. Отказ выше — «операции некому ответить» —
приходит на той же фазе, поэтому топология, которая не поднимется, видна
в матрице, а не на первом запуске.

Состав без графа даёт третий вход декларации — `discover(args)`. Он
выполняет только фазу 0 и возвращает endpoint'ы с именами объявивших
единиц: чем ответит приложение при этом аргументе. Вызов синхронный, и
источников конфига он не поднимает; ошибки графа остаются за `check()`.
Из него собирается документ OpenAPI в CI ([глава 13](./13-openapi-and-client.md)).

Подстановок `check()` не принимает: он проверяет честный граф. Секреты
приходят опцией `config`, тем же списком `bind()`, что и у `run()` —
у декларации привязок нет вовсе. Секреты `API_TOKEN` и `WEBHOOK_SECRET`
нужны и здесь, потому что `build()` создаёт секцию конфига.

```typescript
// src/app.spec.ts
  it('собирает каждый вариант деплоя без сокетов', async () => {
    const reports = await checkTopologies(
      checked,
      [
        { features: 'all' },
        { features: 'users', includeDeps: true },
        { features: 'ops' },
      ],
      CHECK_OPTIONS,
    );

    // `users` зовёт `notifications.check-address`, поэтому замыкание по
    // операциям тянет фичу рассылки. `ops` никто не вызывает, и она
    // приходит только явным выбором
    expect(reports[1].report.features).toEqual(['users', 'notifications']);
    expect(
      reports[2].report.endpoints.map(({ pattern }) => pattern).sort(),
    ).toEqual([
      'DELETE /ops/subscriptions/:id',
      'GET /healthz',
      'GET /openapi.json',
      'GET /ops/subscriptions',
      'GET /ops/subscriptions/live',
      'GET /readyz',
      'subscriptions.closed@ops',
      'subscriptions.opened@ops',
    ]);
  });
```

Результат содержит пару `{ args, report }` на каждый вариант. Отчёт
перечисляет `features`, `switches`, `endpoints` с паттерном, транспортом
и причиной `detached`, `transports` и `operations`. Endpoint `GET /openapi.json`
в отчёте роли `ops` принадлежит плагину документации, а реализации
операций видны под именами вида `subscriptions.opened@ops`.

```typescript
// src/app.spec.ts
  it("проверяет политики и перечисляет detached-endpoint'ы в отчёте", async () => {
    const [{ report }] = await checkTopologies(
      checked,
      [{ features: 'all' }],
      CHECK_OPTIONS,
    );

    expect(
      report.endpoints
        .filter(({ detached }) => detached !== undefined)
        .map(({ pattern }) => pattern)
        .sort(),
    ).toEqual([
      'GET /healthz',
      'GET /readyz',
      'POST /hooks/users',
      'POST /login',
    ]);
  });
```

```typescript
// src/app.spec.ts
  it('проверяет обе ветки переключателя документации', async () => {
    const [withDocs, withoutDocs] = await checkTopologies(
      checked,
      [
        { features: 'all', docs: 'on' },
        { features: 'all', docs: 'off' },
      ],
      CHECK_OPTIONS,
    );

    expect(withDocs.report.switches).toEqual({ docs: 'on' });
    expect(withoutDocs.report.switches).toEqual({ docs: 'off' });
  });
```

Топология описывается объектной формой аргумента целиком, поэтому матрица
перебирает выбор фич и ветки переключателей одним списком. Маркер `argv`
элементом списка не принимается: матрица перечисляет топологии в коде, а
не берёт их из командной строки. Ветка, которая собирается только в
dev-контуре, проверяется тем же тестом, что и остальные.

Политики из главы [10](./10-auth.md) проверяются в каждой топологии
матрицы, а не только в полной сборке. Инвариант, который держится при
выборе `'all'` и ломается на подмножестве, виден в тесте, а не при
выкладке. Причины `detached` приходят значениями в отчёте: тест сравнивает
список, а не читает вывод в консоли.

```bash
yarn test
API_TOKEN=secret WEBHOOK_SECRET=hook yarn start:dev --features ops
```

Роли собираются по отдельности, но пока работают в одном процессе:
[20. Разнести фичи по процессам](./20-split.md).
