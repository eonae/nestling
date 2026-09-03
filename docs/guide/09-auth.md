# 8. Пускать только своих

> Гайд по текущему API; сверено с кодом `examples.users-service` (2026-09-03).
> Целевое описание: [design/pipeline.md](../design/pipeline.md) и
> [design/composition.md](../design/composition.md). Почему так: записи
> [ideas.md](../decisions/ideas.md) «Pipeline v2: плоские фазы, слои,
> композиция константами» и «Policy-check на собранном графе; `detached` —
> только с причиной».

## Задача

Читать список пользователей может кто угодно, а создавать, менять и
удалять их может только тот, кто предъявил токен. Проверка должна
выполняться до хендлера и отвечать `401` с машинным кодом. Забыть её на
новом endpoint'е должно быть нельзя.

## Решение

### Шаг 1. Отказ проверки

```typescript
// packages/examples.users-service/src/errors.ts
import { defineFail } from '@nestling/operations';

/** Отказ проверки токена. Его бросает pre-юнит слоя `authed`. */
export const Unauthorized = defineFail('UNAUTHORIZED', {
  status: 'UNAUTHORIZED',
  message: 'Bearer token is missing or invalid',
});
```

Отказ объявлен так же, как отказы хендлеров в [главе 3](./03-errors.md).
Статус `UNAUTHORIZED` транспорт переводит в HTTP-код `401`.

### Шаг 2. Pre-юнит, который проверяет токен

```typescript
// packages/examples.users-service/src/auth.ts
import type { Config } from '@nestling/config';
import { Injectable } from '@nestling/container';
import type { EmptyInput, ExtendableContext } from '@nestling/pipeline';
import { compose, makePipeline } from '@nestling/pipeline';

/** Тот, от чьего имени выполняется запрос */
export interface Caller {
  id: string;
}

@Injectable([AppConfig])
export class Authenticate {
  constructor(private readonly config: Config<typeof AppConfig>) {}

  handle(ctx: ExtendableContext<EmptyInput>): { caller: Caller } {
    const header = ctx.raw.attributes.authorization;
    const token =
      typeof header === 'string' && header.startsWith('Bearer ')
        ? header.slice('Bearer '.length)
        : undefined;

    if (token === undefined || token !== this.config.apiToken) {
      throw Unauthorized();
    }

    return { caller: { id: 'api-token' } };
  }
}

export const authed = compose(observability, makePipeline().pre(Authenticate));
```

`Authenticate` — pre-юнит в форме класса. Ему нужна секция конфига из
[главы 5](./05-config.md), поэтому зависимость объявлена в `@Injectable`,
а сам класс регистрируется в `providers:` фичи.

Метод `handle` получает контекст запроса. `ctx.raw.attributes` — заголовки
HTTP-запроса; имена заголовков приведены к нижнему регистру. Юнит
сравнивает токен со значением `apiToken` из секции конфига.

Юнит завершается одним из двух способов.

- `throw Unauthorized()` останавливает пайплайн: хендлер не вызывается,
  и ответная фаза получает этот отказ.
- `return { caller: … }` добавляет поле в контекст. Его увидят следующие
  юниты и хендлер.

`authed` — новый слой, составленный из двух: `compose(outer, inner)`.
Pre-юниты внешнего слоя выполняются раньше, поэтому `requestId` уже
лежит в контексте, когда проверяется токен, а строка аудита пишется и
для отклонённых запросов. Слой `authed` происходит от `observability`, и
это будет важно для политики в шаге 4.

### Шаг 3. Подключить слой и объявить отказ

```typescript
// packages/examples.users-service/src/users/endpoints/delete-user.endpoint.ts
export const DeleteUser = httpEndpoint({
  method: 'DELETE',
  path: '/users/:id',
  input: DeleteUserInput,
  errors: [UserNotFound, Unauthorized],
  doc: {
    summary: 'Удалить пользователя',
    tags: ['users'],
    status: 'NO_CONTENT',
  },
  pipeline: authed,
  deps: [UsersRepository$],
  handle: deleteUserHandler,
});
```

Endpoint подключает `authed` вместо `observability`. Отказ `Unauthorized`
бросает слой, а не хендлер, но в `errors:` его объявляет endpoint: список
`errors:` описывает всё, что может получить клиент. Отказ, которого нет
в списке, граница пайплайна заменяет на `UNKNOWN` с кодом `500`.

Поля, которые pre-юниты положили в контекст, хендлер получает вторым
аргументом вместе с двумя зарезервированными ключами: `signal` для отмены
запроса и `fail` для раннего выхода. Хендлеры примера имя вызывающего не
используют, но могли бы:

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
# {"error":"Bearer token is missing or invalid","code":"UNAUTHORIZED"} 401
curl -X DELETE -H 'authorization: Bearer secret' http://localhost:3000/users/2
# 204
```

### Шаг 4. Политики: гарантия вместо дисциплины

Новый endpoint с `pipeline: observability` компилируется и работает, но
пропускает всех. Чтобы такой endpoint не дошёл до запуска, корень
объявляет политики сборки:

```typescript
// packages/examples.users-service/src/app.ts
import { everyEndpoint } from '@nestling/pipeline';
import { http, HttpTransport$ } from '@nestling/transport.http';

export const appSpec = {
  features: [UsersFeature],
  // …
  transports: [http()],
  policies: [
    // У каждого HTTP-endpoint'а есть слой наблюдаемости
    everyEndpoint({ transport: HttpTransport$('default') }).hasLayer(
      observability,
      'observability',
    ),
    // Каждый endpoint, который меняет данные, проверяет токен
    everyEndpoint({ pattern: /^(POST|PATCH|DELETE) / }).hasLayer(
      authed,
      'authed',
    ),
  ],
};
```

Политика — инвариант над собранным графом. `everyEndpoint(filter)`
отбирает endpoint'ы: по токену транспорта или по регулярному выражению
на паттерне. `.hasLayer(layer, label)` требует, чтобы пайплайн каждого
отобранного endpoint'а происходил от этого слоя. `label` попадает в текст
нарушения.

Слой сравнивается по ссылке, а не по содержимому. `authed` составлен из
`observability`, поэтому endpoint с `pipeline: authed` удовлетворяет обеим
политикам. Слой с тем же набором юнитов, объявленный в другом файле,
первую политику не пройдёт.

Политики проверяются на фазе ASSEMBLE: до `@OnInit`, до открытия сокета.
Endpoint `POST /rogue` со слоем `observability` остановит запуск с таким
сообщением:

```
1 endpoint violation(s) of assembly policies:

policy: every endpoint (pattern /^(POST|PATCH|DELETE) /) has layer 'authed'
  - POST /rogue (http, module 'rogue'): its pipeline is not composed from layer 'authed'

Fix each handle by composing the required layer into its 'pipeline:', or opt out deliberately with detached: '<reason>' in its declaration.
```

Endpoint без `pipeline:` политику тоже нарушает: для инварианта
«endpoint защищён» отсутствие пайплайна и отсутствие слоя неразличимы.

### Шаг 5. Исключение с причиной

Проба живости для балансировщика не должна писать строку аудита на каждый
запрос. Endpoint выводится из-под политик полем `detached`:

```typescript
// packages/examples.users-service/src/users/endpoints/health.endpoint.ts
export const Health = httpEndpoint({
  method: 'GET',
  path: '/health',
  output: z.object({ status: z.string() }),
  detached:
    'проба балансировщика: строка аудита на каждый запрос заслоняет полезные записи',
  doc: { hidden: 'служебная проба, не часть публичного API' },
  handle: async () => ({ status: 'up' }),
});
```

`detached` принимает только непустую строку с причиной; формы `detached:
true` нет. Причина видна в диффе, печатается при старте и попадает в
отчёт `check()`:

```
[nestling] detached from policies: GET /health (http) — проба балансировщика: …
```

Поле `doc.hidden` относится к документу OpenAPI и описано в
[главе 10](./10-openapi-and-client.md).

### Шаг 6. Подсказка в редакторе

```javascript
// packages/examples.users-service/eslint.config.js
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

Правило `endpoint-has-layer` из `@nestling/eslint-plugin` подсвечивает
`httpEndpoint` без нужного слоя прямо в редакторе. Правило синтаксическое
и видит только текст декларации, поэтому его уровень `warn`. Гарантию
даёт политика на собранном графе.

## Что гарантирует фреймворк

- Endpoint, который меняет данные и не подключил `authed`, останавливает
  сборку до открытия сокета. Сообщение называет endpoint, политику и два
  способа починить.
- Копия слоя с тем же содержимым политику не проходит: сравнение идёт по
  ссылке, и обойти проверку переобъявлением слоя нельзя.
- Отказ из pre-юнита проходит ту же проверку `errors:`, что и отказ
  хендлера. Незадекларированный отказ становится `UNKNOWN`.
- Слой может объявить требование к внешнему контексту:
  `makePipeline<{ caller: Caller }>()`. Композиция такого слоя с внешним
  слоем, который `caller` не добавляет, не компилируется.

## Как проверить

```typescript
// packages/examples.users-service/src/app.spec.ts
it('отклоняет запись без токена до вызова хендлера', async () => {
  const repo = inMemoryUsersRepo([alice]);
  await using app = await assembleTest({
    ...spec,
    overrides: [[UsersRepository$, repo]],
  });

  expect(await app.call(DeleteUser, { id: '1' })).toMatchObject({
    isSuccess: false,
    status: 'UNAUTHORIZED',
    value: { code: 'UNAUTHORIZED' },
  });
  expect(await repo.byId('1')).toEqual(alice);
});

it('создаёт пользователя по токену из конфига', async () => {
  await using app = await assembleTest({
    ...spec,
    overrides: [[UsersRepository$, inMemoryUsersRepo()]],
  });

  const created = await app.call(
    CreateUser,
    { name: 'Carol', email: 'carol@example.com' },
    { attributes: { authorization: 'Bearer test-token' } },
  );

  expect(created).toMatchObject({
    isSuccess: true,
    status: 'CREATED',
    value: { name: 'Carol' },
  });
});
```

`app.call` без заголовков даёт отказ `UNAUTHORIZED`, и хранилище остаётся
нетронутым: хендлер не вызывался. Заголовки в app-тесте передаются опцией
`attributes`. Значение токена берётся из `vars({ API_TOKEN: 'test-token' })`
в общем `spec` теста. Политики в тестовой сборке те же, что в
`main.ts`: `spec` расширяет `appSpec`, а не переписывает его.

## Пока не нужно

- Токен из конфига заменяет настоящую проверку личности. Проверка JWT
  или запрос к сервису сессий пишется в том же юните; форма слоя и
  политики не меняются.
- Права и роли — поля `caller`, которые вы добавите сами. Готовые юниты
  `withIdentity` и `withPermissions` из `@nestling/pipeline` описаны в
  README пакета.
- Политика `.hasVar(variable)` проверяет, что пайплайн объявляет
  переменную контекста. Она понадобится в [главе 12](./12-events.md).
- Отчёт `check()` со списком `detached`-endpoint'ов появится в
  [главе 15](./15-select.md).

## Запускаемый код

- `packages/examples.users-service/src/errors.ts` — отказ `Unauthorized`.
- `packages/examples.users-service/src/auth.ts` — юнит `Authenticate` и
  слой `authed`.
- `packages/examples.users-service/src/users/endpoints/delete-user.endpoint.ts`
  и `create-user.endpoint.ts` — endpoint'ы под слоем `authed`.
- `packages/examples.users-service/src/users/endpoints/health.endpoint.ts`
  — исключение с `detached`.
- `packages/examples.users-service/src/app.ts` — политики.
- `packages/examples.users-service/eslint.config.js` — правило для
  редактора.

```bash
API_TOKEN=secret yarn workspace examples.users-service start:dev
curl -X POST http://localhost:3000/users \
  -H 'content-type: application/json' \
  -d '{"name":"Carol","email":"carol@example.com"}'
# 401 UNAUTHORIZED
curl -X POST http://localhost:3000/users \
  -H 'authorization: Bearer secret' -H 'content-type: application/json' \
  -d '{"name":"Carol","email":"carol@example.com"}'
# 201, Location: /users/3
```

## Дальше

Файлы, выгрузки и импорт, которые не помещаются в память:
[глава 9](./09-files-and-streams.md).
