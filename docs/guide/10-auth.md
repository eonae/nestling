# 10. Пускать только своих

> Гайд по текущему API; сверено с кодом `users-service` (2026-09-08).
> Целевое описание: [design/pipeline.md](../design/pipeline.md) и
> [design/composition.md](../design/composition.md). Почему так: записи
> [ideas.md](../decisions/ideas.md) «Pipeline v2: плоские фазы, слои,
> композиция константами», «Policy-check на собранном графе; `detached` —
> только с причиной» и «[2026-09-04] Отказы слоя: объявление в
> `.pre(unit, { errors })`, канал `return` у pre-юнита, эффективное
> множество `errors`».

Читать список пользователей может кто угодно, а создавать, менять и
удалять их может только тот, кто предъявил Bearer-токен. Проверка выполняется
до хендлера и отвечает `401` с машинным кодом. Забыть её на новом
endpoint'е должно быть нельзя.

```typescript
// examples/users-service/src/errors.ts
import { makeFail } from '@nestling/operations';

/** Отказ проверки Bearer-токена. Его возвращает pre-юнит слоя `authed`. */
export const Unauthorized = makeFail('unauthorized', {
  message: 'Bearer token is missing or invalid',
});
```

Отказ объявлен так же, как отказы хендлеров в [главе 4](./04-errors.md).
Статус `unauthorized` транспорт переводит в HTTP-код `401`.

```typescript
// examples/users-service/src/auth.ts
import type { Config, EmptyInput, ExtendableContext } from '@nestling/app';
import { compose, makePipeline } from '@nestling/app';
import { Injectable } from '@nestling/container';

/** Тот, от чьего имени выполняется запрос */
export interface Caller {
  id: string;
}

@Handler([AppConfig])
export class Authenticate {
  constructor(private readonly config: Config<typeof AppConfig>) {}

  handle(
    ctx: ExtendableContext<EmptyInput>,
  ): { caller: Caller } | ReturnType<typeof Unauthorized> {
    const header = ctx.raw.attributes.authorization;
    const token =
      typeof header === 'string' && header.startsWith('Bearer ')
        ? header.slice('Bearer '.length)
        : undefined;

    if (token === undefined || token !== this.config.apiToken) {
      return Unauthorized();
    }

    return { caller: { id: 'api-token' } };
  }
}

export const authed = compose(
  observability,
  makePipeline().pre(Authenticate, { errors: [Unauthorized] }),
);
```

`Authenticate` — pre-юнит в форме класса. Ему нужна секция конфига из
[главы 7](./07-config.md), поэтому зависимость объявлена в декораторе
роли. Роль здесь `@Handler`: у юнита есть метод `handle`. Сам класс
регистрируется в `providers:` фичи.

Метод `handle` получает контекст запроса. `ctx.raw.attributes` — заголовки
HTTP-запроса; имена заголовков приведены к нижнему регистру. Юнит
сравнивает Bearer-токен со значением `apiToken` из секции конфига.

Юнит завершается одним из двух способов.

- `return Unauthorized()` останавливает пайплайн: хендлер не вызывается,
  и ответная фаза получает этот отказ.
- `return { caller: … }` добавляет поле в контекст. Его увидят следующие
  юниты и хендлер.

Отказ юнита объявляется в точке подключения — вторым аргументом `.pre`.
Вернуть отказ вне этого списка нельзя: компилятор отвергнет юнит прямо в
`.pre`. Поле `caller` в накопленный контекст при отказе не попадает:
рантайм узнаёт отказ до записи результата в контекст.

`authed` — новый слой, составленный из двух: `compose(outer, inner)`.
Pre-юниты внешнего слоя выполняются раньше, поэтому `requestId` уже
лежит в контексте, когда проверяется Bearer-токен, а строка аудита пишется и
для отклонённых запросов. Слой `authed` происходит от `observability` —
это использует политика сборки ниже.

Слой может объявить требование к внешнему контексту сигнатурой
`makePipeline<{ caller: Caller }>()`. Композиция такого слоя с внешним
слоем, который поле `caller` не добавляет, не компилируется.

## Подключение слоя и политики

```typescript
// examples/users-service/src/users/endpoints/delete-user.endpoint.ts
export const DeleteUser = httpEndpoint({
  method: 'DELETE',
  path: '/users/:id',
  input: DeleteUserInput,
  errors: [UserNotFound],
  doc: {
    summary: 'Удалить пользователя',
    tags: ['users'],
    status: 'no_content',
  },
  pipeline: authed,
  handler: DeleteUserHandler,
});
```

Endpoint подключает `authed` вместо `observability`. `Unauthorized` в
`errors:` не перечислен: его объявил слой. Множество отказов endpoint'а
складывается из `errors:` словаря и отказов его слоёв, и это множество
получают тип хендлера, проверка на границе и документ OpenAPI. Отказ из
pre-юнита проходит ту же проверку, что и отказ хендлера:
незадекларированный отказ граница пайплайна заменяет на `internal_error`
с кодом `500`.

Один и тот же отказ можно объявить и на слое, и в `errors:` — множество
считает его одним. Обратный порядок работы тоже становится проще: новый
endpoint со слоем `authed` отвечает `401` и показывает этот ответ в
OpenAPI, не перечисляя чужой отказ у себя. Политика `hasLayer` ниже
требует слой у всех мутирующих endpoint'ов, поэтому `401` появляется у
каждого из них разом.

Поля, которые pre-юниты положили в контекст, хендлер получает вторым
аргументом вместе с зарезервированным ключом `signal` — сигналом отмены
запроса. Хендлеры примера имя вызывающего не используют, но могли бы:

```typescript
// иллюстрация; хендлеры примера поле caller не читают
handle:
  (users: UsersRepository) =>
  async (payload: DeleteUserInput, meta: { caller: Caller }) => {
    // meta.caller.id
  },
```

Проверьте ответы:

```bash
curl -X DELETE http://localhost:3000/users/2
# {"error":"Bearer token is missing or invalid","code":"unauthorized"} 401
curl -X DELETE -H 'authorization: Bearer secret' http://localhost:3000/users/2
# 204
```

Новый endpoint с `pipeline: observability` компилируется и работает, но
пропускает всех. Чтобы такой endpoint не дошёл до запуска, корень
объявляет политики сборки:

```typescript
// шаг главы 9; итоговая версия: examples/users-service/src/app.ts
import { everyEndpoint } from '@nestling/app';
import { http, HttpTransport$ } from '@nestling/transport.http';

export const app = makeApp({
  features: [UsersFeature],
  // …
  transports: [http()],
  policies: [
    // У каждого HTTP-endpoint'а есть слой наблюдаемости
    everyEndpoint({ transport: HttpTransport$('default') }).hasLayer(
      observability,
      'observability',
    ),
    // Каждый endpoint, который меняет данные, проверяет Bearer-токен
    everyEndpoint({ pattern: /^(POST|PATCH|DELETE) / }).hasLayer(
      authed,
      'authed',
    ),
  ],
});
```

Политика — инвариант над собранным графом. `everyEndpoint(filter)`
отбирает endpoint'ы: по DI-токену транспорта или по регулярному выражению
на паттерне. `.hasLayer(layer, label)` требует, чтобы пайплайн каждого
отобранного endpoint'а происходил от этого слоя. `label` попадает в текст
нарушения.

Слой сравнивается по ссылке, а не по содержимому: копия с тем же
содержимым, объявленная в другом файле, политику не проходит, и обойти
проверку переобъявлением слоя нельзя.

Политики проверяются на фазе ASSEMBLE: до создания экземпляров, до открытия сокета.
Endpoint `POST /rogue` со слоем `observability` остановит запуск с таким
сообщением:

```
1 endpoint violation(s) of assembly policies:

policy: every endpoint (pattern /^(POST|PATCH|DELETE) /) has layer 'authed'
  - POST /rogue (http, module 'rogue'): its pipeline is not composed from layer 'authed'

Fix each handle by composing the required layer into its 'pipeline:', or opt out deliberately with detached: '<reason>' in its declaration.
```

Сообщение называет endpoint, политику и два способа починить. Endpoint
без `pipeline:` политику тоже нарушает: для инварианта «endpoint защищён»
отсутствие пайплайна и отсутствие слоя неразличимы.

## Вторая проверка: переменная контекста объявлена

В [главе 9](./09-logging.md) хранилище читало идентификатор запроса через
`Ctx(RequestId)`. Читатель отдаёт значение, которое положил pre-юнит слоя.
Если к маршруту слой не подключён, `peek()` вернёт `undefined`, а `get()`
бросит ошибку. Компилятор такой пропуск не видит: у хранилища нет типа
входа запроса, и читатель одинаков для всех маршрутов.

Присутствие переменной требует второй предикат:

```typescript
// examples/users-service/src/app.ts
everyEndpoint({ transport: HttpTransport$('default') }).hasVar(
  RequestId,
  'requestId',
),
```

`hasVar(variable, label)` требует, чтобы пайплайн отобранного endpoint'а
объявлял эту переменную. Объявлением считается pre-юнит вида
`Var.provide(…)`; `withRequestId()` из главы 9 — такой юнит. Юнит, который
кладёт поле `requestId` в контекст обычной функцией, читателям значение
даёт, но предикат его не засчитывает: иначе проверка сводилась бы к
совпадению имён полей.

Предикаты закрывают два разных пропуска. `hasLayer` отвечает за слой,
который забыли подключить, `hasVar` — за значение, которое читают из
глубины графа. Устроены они одинаково: фильтр отбирает endpoint'ы,
предикат проверяет пайплайн, нарушения всех политик собираются в одно
сообщение.

Политика — обычное значение, поэтому отдавать её может и плагин.
`@nestling/outbox` так требует, чтобы изменяющий endpoint был
композирован от слоя транзакции: фильтр задаёт корень, переменную
называет плагин ([глава 27](./27-database-and-transaction.md)).

## Исключение из политик и подсказка в редакторе

Проба живости для балансировщика не должна писать строку аудита на каждый
запрос. Endpoint выводится из-под политик полем `detached`:

```typescript
// examples/users-service/src/ops.plugin.ts
export const CheckHealth = httpEndpoint({
  method: 'GET',
  path: '/health',
  output: z.object({ status: z.string() }),
  detached:
    'проба балансировщика: строка аудита на каждый запрос заслоняет полезные записи',
  doc: { hidden: 'служебная проба, не часть публичного API' },
  handler: async () => ({ status: 'up' }),
});
```

`detached` принимает только непустую строку с причиной; формы `detached:
true` нет. Причина видна в диффе, печатается при старте и попадает в
отчёт `check()`:

```
[nestling] detached from policies: GET /health (http) — проба балансировщика: …
```

Поле `doc.hidden` управляет документом OpenAPI, а не политиками сборки.

Правило `endpoint-has-layer` из `@nestling/eslint-plugin` подсказывает
про тот же инвариант прямо в редакторе:

```javascript
// examples/users-service/eslint.config.js
export default [
  ...createEslintConfig(import.meta.url),
  {
    files: ['src/**/*.ts'],
    plugins: { '@nestling': nestling },
    rules: {
      '@nestling/endpoint-has-layer': [
        'warn',
        { layer: 'observability', constructorName: 'httpEndpoint' },
      ],
    },
  },
];
```

Правило синтаксическое и видит только текст декларации, поэтому его
уровень `warn`. Гарантию даёт политика на собранном графе.

## HTTP-форма хендлера: cookie и редирект

Вход выдаёт сессию: ответ ставит cookie и уводит браузер на приложение.
Ни того, ни другого `Ok` не выражает — заголовки и статус 3xx принадлежат
HTTP. Их задаёт форма ответа своего транспорта:

```typescript
// examples/app-with-http/src/features/users/endpoints/login.endpoint.ts
@Handler([UsersRepository$])
export class LoginHandler {
  constructor(private readonly users: UsersRepository) {}

  async handle(
    input: { email: string },
    meta: HttpHandlerMeta,
  ): HttpOutput<never, typeof UserNotFound> {
    const user = await this.users.byEmail(input.email);
    if (!user) {
      return UserNotFound({ id: input.email });
    }

    const secure = meta.http.headers['x-forwarded-proto'] === 'https';

    return HttpResponse.redirect('/app', {
      cookies: [
        { name: 'sid', value: user.id, path: '/', httpOnly: true, secure },
      ],
    });
  }
}

export const Login = httpEndpoint({
  method: 'POST',
  path: '/login',
  input: Credentials,
  redirect: 303,
  errors: [UserNotFound],
  detached: 'вход выдаёт сессию, поэтому Bearer-токена у него ещё нет',
  pipeline: observability,
  handler: LoginHandler,
});
```

`meta.http` — запрос: метод, url, заголовки и адрес сокета.
`HttpResponse.of(ok, { headers, cookies })` даёт обычный ответ с
заголовками, `HttpResponse.redirect(location, { status, cookies })` —
редирект. Каждая cookie уходит отдельным заголовком `Set-Cookie`.

Редирект объявляется декларацией полем `redirect`. По нему документ
OpenAPI показывает ответ 3xx с заголовком `Location`, а транспорт берёт
статус, если вызов свой не задал. Хендлер, вернувший редирект у
декларации без этого поля, получает `internal_error`: документ разошёлся
бы с поведением.

HTTP-форма допустима только там, где адрес объявлен транспортом, — в
анонимном `httpEndpoint`. В `implement` и в форму `httpEndpoint({
operation })` такой класс не проходит по типам: реализация операции
обязана оставаться переносимой на шину. Хендлер без `meta.http` и без
`HttpResponse` годится всюду.

Класс-хендлер объявляет интерфейс: `implements Handler<typeof Op>` берёт
типы входа, результата и отказов с операции, `implements HttpHandler<typeof
Op>` — то же с `meta.http` и `HttpOutput`. Оба имени приходят одним
импортом с декоратором роли.

## Юниты транспорта

Юниту, которому нужен запрос, транспорт даёт стартовый контекст
`HttpStartContext`:

```typescript
const httpBase = makePipeline<HttpStartContext>()
  .pre(withHeader('x-tenant'))
  .pre(withClientIp())
  .finally(httpAccessLog(logger));
```

`withHeader(name)` кладёт значение заголовка в контекст под тем же именем;
переименования нет. `withClientIp()` кладёт адрес сокета в поле
`clientIp` — за прокси это адрес прокси, и разбор `X-Forwarded-For` пишет
приложение. `httpAccessLog(logger)` пишет строку доступа с методом,
путём, статусом, исходом и счётчиками байтов.

Такой пайплайн допустим в HTTP-декларации и не компилируется в
`implement`: слот называет недостающие поля литералом ошибки. Транспорт
юниты не приставляет — слой всегда виден в декларации.

## Проверка

```typescript
// examples/users-service/src/app.spec.ts
it('отклоняет запись без Bearer-токена до вызова хендлера', async () => {
  const repo = inMemoryUsersRepo([alice]);
  await using testApp = await assembleTest(app, {
    config: testConfig,
    overrides: [[UsersRepository$, repo]],
  });

  expect(await testApp.call(DeleteUser, { id: '1' })).toMatchObject({
    isSuccess: false,
    status: 'unauthorized',
    value: { code: 'unauthorized' },
  });
  expect(await repo.byId('1')).toEqual(alice);
});

it('создаёт пользователя по Bearer-токену из конфига', async () => {
  await using testApp = await assembleTest(app, {
    config: testConfig,
    overrides: [[UsersRepository$, inMemoryUsersRepo()]],
  });

  const created = await testApp.call(
    CreateUser,
    { name: 'Carol', email: 'carol@example.com' },
    { attributes: { authorization: 'Bearer test-token' } },
  );

  expect(created).toMatchObject({
    isSuccess: true,
    status: 'created',
    value: { name: 'Carol' },
  });
});
```

`testApp.call` без заголовков даёт отказ `unauthorized`, и хранилище
остаётся нетронутым: хендлер не вызывался. Заголовки в app-тесте
передаются опцией `attributes`. Значение Bearer-токена берётся из
`vars({ API_TOKEN: 'test-token' })` в опциях теста. Политики в тестовой
сборке те же, что в `main.ts`: тест собирает ту же декларацию `app`, а
не копию её словаря.

```bash
API_TOKEN=secret yarn workspace @examples/users-service start:dev
curl -X POST http://localhost:3000/users \
  -H 'content-type: application/json' \
  -d '{"name":"Carol","email":"carol@example.com"}'
# 401 unauthorized
curl -X POST http://localhost:3000/users \
  -H 'authorization: Bearer secret' -H 'content-type: application/json' \
  -d '{"name":"Carol","email":"carol@example.com"}'
# 201
```

Файлы, выгрузки и импорт, которые не помещаются в память:
[глава 11](./11-files-and-streams.md).
