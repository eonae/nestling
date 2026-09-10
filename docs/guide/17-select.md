# 17. Запускать только часть фич

> Гайд по текущему API; сверено с кодом `app-with-http` (2026-09-10).
> Целевое описание: [design/composition.md](../design/composition.md)
> «L2 — фичи, выбор и переключатели» и «`check()`». Почему так: записи
> [ideas.md](../decisions/ideas.md) «[2026-07-08] Модульный монолит: фичи,
> `select`», «[2026-09-02] Модель композиции: фича, плагин, операция» и
> «[2026-09-06] Переключатели состава: `makeSwitch`, `pick` и `when`,
> аргумент сборки; формы корня без фич».

Приложение состоит из фич `users`, `quotas` и `ops`. Локально оно
запускается одним процессом. В проде пользовательский API и служебные
endpoint'ы разворачиваются отдельно, и каждый процесс должен поднимать
только свои фичи. Один и тот же код должен собираться во все три роли, а
неверный состав должен останавливать сборку, а не первый запрос.

## Прочитайте аргумент сборки до контейнера

```typescript
// examples/app-with-http/src/main.ts
import { app } from './app.js';

import { from, load, makeConfig } from '@nestlingjs/app';
import { z } from 'zod';

/**
 * Секция корня: аргумент сборки читается до контейнера.
 *
 * Префикс `root` отличает её от секции `app` в `app.config.ts`, ключ
 * выбора фич задан точно (`APP_FEATURES`), а значения переключателей
 * описаны их схемами.
 */
const RootConfig = makeConfig('root', {
  features: from('APP_FEATURES', z.string().default('all')),
  docs: from('APP_DOCS', Docs.schema),
});

/**
 * Точка входа. `APP_FEATURES=users` поднимает фичу пользователей и те
 * фичи, чьи операции она вызывает; `APP_FEATURES=all` поднимает все.
 * `APP_DOCS=off` убирает документацию из состава.
 */
const cfg = load(RootConfig);

await app.assemble({ ...cfg, includeDeps: true }).run();
```

`load(section)` читает значения до сборки контейнера: синхронно и только
из `process.env`. Так устроено потому, что аргумент сборки определяет
состав контейнера, а секция внутри контейнера появилась бы уже после
выбора. Источники, привязанные в `config:`, в этом чтении не участвуют.
Это единственное чтение конфига до сборки.

Ключ `APP_FEATURES` задан через `from()`: у корня свой префикс `root`,
потому что префикс `app` уже занят секцией приложения.

Поля секции названы так же, как поля аргумента сборки, поэтому `cfg`
подходит `assemble` целиком. Имя `docs` — имя переключателя, и лишнее
поле в этом объекте не скомпилируется.

## Формы аргумента и замыкание по вызовам

| Запись | Что выбирает |
|---|---|
| `'all'` | все фичи из `features:` |
| `'users,ops'` | фичи по именам; пробелы вокруг имён игнорируются |
| `['users', 'ops']` | то же списком |
| `{ features, includeDeps: true }` | фичи по именам плюс фичи, чьи операции они вызывают |
| `{ features, docs: 'off' }` | те же фичи плюс значения переключателей |

Строковая форма нужна потому, что выбор приходит из переменной
окружения; значения переключателей при ней берутся из умолчаний. Если
`features:` заданы, а выбор нет, выбраны все фичи. Плагины из `plugins:`
в выбор не входят: они есть в каждом процессе. Невыбранная фича
отсутствует в процессе целиком: её провайдеры не создаются, её
endpoint'ы не регистрируются, её реализации операций не подписываются.
Неизвестное имя фичи останавливает сборку, и ошибка перечисляет
доступные, так же как две фичи с одним именем, пустой выбор и выбор без
`features:`.

```bash
APP_FEATURES=users API_TOKEN=secret WEBHOOK_SECRET=hook yarn workspace @examples/app-with-http start:dev
```

```
[nestling] features: users, quotas; transports: http, bus
[nestling] selection closed over calls: users + quotas
[nestling] detached from policies: POST /hooks/users (http) — webhook: подлинность проверяется подписью тела, а не Bearer-токеном
```

Выбрана одна фича, а в процессе две. `includeDeps: true` замыкает выбор
по вызываемым операциям: фича `users` инжектит `ClaimQuota.caller` и
`SignupRecorded.emitter`, владелец обеих операций живёт в `quotas`, и
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
[nestling] features: ops; transports: http, bus
[nestling] selection closed over calls: ops (nothing added)
```

Сборка с выбором `'users'` без `includeDeps` останавливается на фазе
ASSEMBLE:

```
Operation 'quotas.claim' (kind 'request') is injected as '.caller', but no
selected feature implements it and this assembly has no intercom, so the
call has nowhere to go. Either add the feature that implements it to the
assembly argument (or close the selection over calls with
'assemble({ features, includeDeps: true })'), or assign the intercom role
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
// examples/app-with-http/src/app.ts
export const Docs = makeSwitch('docs', { default: 'on' });

export const app = makeApp({
  features: [UsersFeature, QuotasFeature, OpsFeature],
  plugins: [
    appObservability,
    appAuth,
    appSubscriptions,
    // При `docs=off` плагина в сборке нет целиком
    Docs.when(appOpenapi),
  ],
  switches: [Docs],
  transports: [http()],
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

Словарь `switches:` объявляет корень, и из него выводится тип аргумента
сборки. Поле переключателя с умолчанием необязательно, без умолчания
обязательно, значение вне словаря не компилируется:

```typescript
app.assemble({ features: 'all', docs: 'off' }); // ок
app.assemble({ features: 'all', doc: 'off' }); // не компилируется: поля нет
app.assemble({ features: 'all', docs: 'no' }); // не компилируется: нет значения
```

Те же четыре проверки повторяет рантайм на фазе ASSEMBLE — для
JS-потребителей и для значений, пришедших из окружения: значение не из
словаря, `pick` на переключателе вне `switches:`, два переключателя с
одним именем, значение без умолчания не передано.

DI-токена у переключателя нет: инжектировать выбор нельзя. Состав не
протекает в код приложения, поэтому провайдер не может вести себя
по-разному «в зависимости от того, как собрано» — вместо этого его
попросту нет в графе.

Выбор виден в строке старта рядом с фичами:

```
[nestling] features: users, quotas; docs=off; transports: http, bus
```

и в отчёте `check()` полем `switches`.

## Плагины и проверка каждой роли без сокетов

```typescript
// examples/app-with-http/src/app.spec.ts
  it('подключает плагины и только выбранную фичу', async () => {
    // `ops` выбрана одна: провайдеров фичи `users` в графе нет, а плагины
    // есть в любой сборке
    await using testApp = await assembleTest(app, {
      ...testConfig,
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
// examples/app-with-http/src/app.spec.ts
/**
 * Декларация для `check()`: подстановок у структурной проверки нет,
 * поэтому значения секретов привязываются источником к ключам секции
 */
const checked = makeApp({
  features: app.spec.features,
  plugins: app.spec.plugins,
  switches: app.spec.switches,
  policies: app.spec.policies,
  transports: app.spec.transports,
  config: [[objectSource(testEnv, 'test'), appConfigKeys]],
});
```

`check()` у приложения выполняет фазы 0 и 1: разбор аргумента сборки,
раскрытие веток переключателей, регистрацию, discovery, `build()` и
проверку политик. Ни один конструктор не
выполняется, `acquire`, `@OnStart` и `serve` не вызываются, ресурсы не
захватываются. Он бросает те же ошибки, что
бросил бы `run()` на фазах 0 и 1, и не влияет на последующий `run()` того
же приложения. `checkTopologies(app, topologies)` из `@nestlingjs/testing`
вызывает `check()` для каждого аргумента сборки и собирает ошибки всех
вариантов в одно сообщение.

Состав без графа даёт третий вход декларации — `discover(args)`. Он
выполняет только фазу 0 и возвращает endpoint'ы с именами объявивших
единиц: чем ответит приложение при этом аргументе. Вызов синхронный, и
источников конфига он не поднимает; ошибки графа остаются за `check()`.
Из него собирается документ OpenAPI в CI ([глава 12](./12-openapi-and-client.md)).

Подстановок `check()` не принимает: он проверяет честный граф. Поэтому
секреты приходят не из `vars()`, а привязкой источника к ключам секции в
самой декларации. Секреты `API_TOKEN` и `WEBHOOK_SECRET` нужны и здесь,
потому что `build()` создаёт секцию конфига.

```typescript
// examples/app-with-http/src/app.spec.ts
  it('собирает каждый вариант деплоя без сокетов', async () => {
    const usersWithDeps = { features: 'users', includeDeps: true } as const;
    const reports = await checkTopologies(checked, [
      'all',
      usersWithDeps,
      'ops',
    ]);

    // `users` зовёт `quotas.claim`, поэтому замыкание по операциям тянет
    // фичу квот. `ops` никто не вызывает, и она приходит только явным выбором
    expect(reports[1].report.features).toEqual(['users', 'quotas']);
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
// examples/app-with-http/src/app.spec.ts
  it("проверяет политики и перечисляет detached-endpoint'ы в отчёте", async () => {
    const [{ report }] = await checkTopologies(checked, ['all']);

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
// examples/app-with-http/src/app.spec.ts
  it('проверяет обе ветки переключателя документации', async () => {
    const [withDocs, withoutDocs] = await checkTopologies(checked, [
      { features: 'all', docs: 'on' },
      { features: 'all', docs: 'off' },
    ]);

    expect(withDocs.report.switches).toEqual({ docs: 'on' });
    expect(withoutDocs.report.switches).toEqual({ docs: 'off' });
  });
```

Топология описывается аргументом сборки целиком, поэтому матрица
перебирает выбор фич и ветки переключателей одним списком. Ветка, которая
собирается только в dev-контуре, проверяется тем же тестом, что и
остальные.

Политики из главы [10](./10-auth.md) проверяются в каждой топологии
матрицы, а не только в полной сборке. Инвариант, который держится при
выборе `'all'` и ломается на подмножестве, виден в тесте, а не при
выкладке. Причины `detached` приходят значениями в отчёте: тест сравнивает
список, а не читает вывод в консоли.

```bash
yarn workspace @examples/app-with-http test
APP_FEATURES=ops API_TOKEN=secret WEBHOOK_SECRET=hook yarn workspace @examples/app-with-http start:dev
```

Роли собираются по отдельности, но пока работают в одном процессе:
[18. Разнести фичи по процессам](./18-split.md).
