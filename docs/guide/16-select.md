# 16. Запускать только часть фич

> Гайд по текущему API; сверено с кодом `app-with-http` (2026-09-05).
> Целевое описание: [design/composition.md](../design/composition.md)
> «L2 — фичи и `select`» и «`check()`». Почему так: записи
> [ideas.md](../decisions/ideas.md) «[2026-07-08] Модульный монолит: фичи,
> `select`» и «[2026-09-02] Модель
> композиции: фича, плагин, операция».

Приложение состоит из фич `users`, `quotas` и `ops`. Локально оно
запускается одним процессом. В проде пользовательский API и служебные
endpoint'ы разворачиваются отдельно, и каждый процесс должен поднимать
только свои фичи. Один и тот же код должен собираться во все три роли, а
неверный состав должен останавливать сборку, а не первый запрос.

## Прочитайте выбор фич до сборки

```typescript
// examples/app-with-http/src/main.ts
import { app } from './app.js';

import { from, load, makeConfig } from '@nestling/config';
import { z } from 'zod';

/**
 * Секция корня: выбор фич читается до сборки контейнера.
 *
 * Префикс `root` отличает её от секции `app` в `app.config.ts`, а ключ
 * задан точно: `APP_FEATURES`.
 */
const RootConfig = makeConfig('root', {
  features: from('APP_FEATURES', z.string().default('all')),
});

/**
 * Точка входа. `APP_FEATURES=users` поднимает фичу пользователей и те
 * фичи, чьи операции она вызывает; `APP_FEATURES=all` поднимает все.
 */
const cfg = load(RootConfig);

await app.assemble({ features: cfg.features, includeDeps: true }).run();
```

`load(section)` читает значения до сборки контейнера: синхронно и только
из `process.env`. Так устроено потому, что выбор фич определяет состав
контейнера, а секция внутри контейнера появилась бы уже после выбора.
Источники, привязанные в `config:`, в этом чтении не участвуют. Это
единственное чтение конфига до сборки.

Ключ `APP_FEATURES` задан через `from()`: у корня свой префикс `root`,
потому что префикс `app` уже занят секцией приложения.

## Формы выбора и замыкание по вызовам

| Запись | Что выбирает |
|---|---|
| `'all'` | все фичи из `features:` |
| `'users,ops'` | фичи по именам; пробелы вокруг имён игнорируются |
| `['users', 'ops']` | то же списком |
| `{ features, includeDeps: true }` | фичи по именам плюс фичи, чьи операции они вызывают |

Строковая форма нужна потому, что выбор приходит из переменной
окружения. Если `features:` заданы, а `select` нет, выбраны все фичи.
Плагины из `plugins:` в выбор не входят: они есть в каждом процессе.
Невыбранная фича отсутствует в процессе целиком: её провайдеры не
создаются, её endpoint'ы не регистрируются, её реализации операций не
подписываются. Неизвестное имя в `select` останавливает сборку, и ошибка
перечисляет доступные фичи, так же как две фичи с одним именем, пустой
выбор и `select` без `features:`.

```bash
APP_FEATURES=users API_TOKEN=secret WEBHOOK_SECRET=hook yarn workspace @examples/app-with-http start:dev
```

```
[nestling] features: users, quotas; transports: http, bus
[nestling] selection closed over calls: users + quotas
[nestling] detached from policies: POST /hooks/users (http) — webhook: подлинность проверяется подписью тела, а не bearer-токеном
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
call has nowhere to go. Either add the feature that implements it to
'select' (or close the selection over calls with
'select: { features, includeDeps: true }'), or assign the intercom role to
a bus transport ('transports: [nats({ name: "events" })]' with
'intercom: "events"') when the owner lives in another process.
```

Ошибка называет операцию, вызывателя и два способа починить: включить
владельца в выбор или назначить интерком, когда владелец работает в
другом процессе.

## Плагины и проверка каждой роли без сокетов

```typescript
// examples/app-with-http/src/app.spec.ts
  it('подключает плагины и только выбранную фичу', async () => {
    // `ops` выбрана одна: провайдеров фичи `users` в графе нет, а плагины
    // есть в любой сборке
    await using testApp = await assembleTest(app, {
      ...testConfig,
      select: 'ops',
    });

    expect(testApp.get(Logger$)).not.toBeNull();
    expect(testApp.get(SubscriptionRegistry)).not.toBeNull();
    expect(testApp.get(ActivityHub)).toBeNull();
  });
```

Логирование, аутентификация, реестр подписок и документ OpenAPI
подключены через `plugins:` и не зависят от `select`. Провайдеров фичи
`users` в этой сборке нет.

```typescript
// examples/app-with-http/src/app.spec.ts
/**
 * Декларация для `check()`: подстановок у структурной проверки нет,
 * поэтому значения секретов привязываются источником к ключам секции
 */
const checked = makeApp({
  features: app.spec.features,
  plugins: app.spec.plugins,
  policies: app.spec.policies,
  transports: app.spec.transports,
  config: [[objectSource(testEnv, 'test'), appConfigKeys]],
});
```

`check()` у приложения выполняет фазы 0 и 1: выбор фич, регистрацию,
discovery, `build()` и проверку политик. `@OnInit`, `@OnStart` и `serve`
не вызываются, ресурсы не захватываются. Он бросает те же ошибки, что
бросил бы `run()` на фазах 0 и 1, и не влияет на последующий `run()` того
же приложения. `checkTopologies(app, selections)` из `@nestling/testing`
вызывает `check()` для каждого варианта `select` и собирает ошибки всех
вариантов в одно сообщение.

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
      'GET /health',
      'GET /openapi.json',
      'GET /ops/subscriptions',
      'GET /ops/subscriptions/live',
      'subscriptions.closed@ops',
      'subscriptions.opened@ops',
    ]);
  });
```

Результат содержит пару `{ select, report }` на каждый вариант. Отчёт
перечисляет `features`, `endpoints` с паттерном, транспортом и причиной
`detached`, `transports` и `operations`. Endpoint `GET /openapi.json`
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
    ).toEqual(['GET /health', 'POST /hooks/users']);
  });
```

Политики из главы [9](./09-auth.md) проверяются в каждой топологии
матрицы, а не только в полной сборке. Инвариант, который держится при
выборе `'all'` и ломается на подмножестве, виден в тесте, а не при
выкладке. Причины `detached` приходят значениями в отчёте: тест сравнивает
список, а не читает вывод в консоли.

```bash
yarn workspace @examples/app-with-http test
APP_FEATURES=ops API_TOKEN=secret WEBHOOK_SECRET=hook yarn workspace @examples/app-with-http start:dev
```

Роли собираются по отдельности, но пока работают в одном процессе:
[17. Разнести фичи по процессам](./17-split.md).
