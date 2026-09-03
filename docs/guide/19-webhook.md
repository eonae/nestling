# 19. Webhook с проверкой подписи

> Гайд по текущему API; сверено с кодом `examples.app-with-http` (2026-09-03).
> Целевое описание: [design/endpoints.md](../design/endpoints.md), раздел
> «Сырые байты: `rawBody`». Почему так: запись
> [ideas.md](../decisions/ideas.md) «[2026-07-13] Канонизация HTTP-input:
> канон размещения + bind-карта».

## Задача

Внешняя система присылает события о пользователях на `POST /hooks/users`
и подписывает тело HMAC-подписью в заголовке `x-signature`. Подпись нужно
проверить по сырым байтам тела: сериализованный заново JSON даст другую
подпись. Хендлер при этом должен получить payload, разобранный и
проверенный схемой, как у любого другого endpoint'а. Bearer-токена у
внешней системы нет, поэтому политика «каждый `POST` проверяет токен» из
[главы 9](./09-auth.md) к этому endpoint'у не применима.

## Решение

### Шаг 1. Отказ проверки подписи

```typescript
// packages/examples.app-with-http/src/features/users/users.errors.ts
export const InvalidSignature = makeFail('unauthorized:invalid_signature', {
  status: 'unauthorized',
  message: 'Webhook signature does not match the body',
});
```

Отказ объявлен так же, как остальные отказы фичи. Статус `unauthorized`
транспорт переводит в `401`.

### Шаг 2. Секрет в секции конфига

```typescript
// packages/examples.app-with-http/src/app.config.ts
export const AppConfig = makeConfig('app', {
  // …
  webhookSecret: secret(from('WEBHOOK_SECRET', z.string().min(1))),
});
```

Секрет читается из `WEBHOOK_SECRET`. Поле обязательно: без него
приложение не стартует. `secret()` скрывает значение в печати секции и в
тексте ошибок, как в [главе 6](./06-config.md).

### Шаг 3. Pre-юнит, который проверяет подпись

```typescript
// packages/examples.app-with-http/src/features/users/endpoints/user-webhook.endpoint.ts
import { createHmac, timingSafeEqual } from 'node:crypto';
// …

@Injectable([AppConfig])
export class VerifySignature {
  constructor(private readonly config: Config<typeof AppConfig>) {}

  handle(ctx: ExtendableContext<{ rawBody: Uint8Array }>): void {
    const provided = String(ctx.raw.attributes['x-signature'] ?? '');
    const expected = createHmac('sha256', this.config.webhookSecret)
      .update(ctx.input.rawBody)
      .digest('hex');

    const matches =
      provided.length === expected.length &&
      timingSafeEqual(Buffer.from(provided), Buffer.from(expected));

    if (!matches) {
      throw InvalidSignature();
    }
  }
}
```

`VerifySignature` устроен так же, как `Authenticate` из
[главы 9](./09-auth.md): класс-юнит с зависимостью от секции конфига,
зарегистрированный в `providers:` модуля `UsersModule`.

Отличие в типе контекста. `ExtendableContext<{ rawBody: Uint8Array }>`
объявляет, что юниту нужны сырые байты тела в `ctx.input.rawBody`. Это
поле кладёт транспорт до первого pre-юнита, если декларация помечена
`rawBody: true`. Без пометки поля нет, и такой юнит в пайплайн не
встанет: проверку делает компилятор (раздел «Что гарантирует фреймворк»).

Заголовок подписи юнит читает из `ctx.raw.attributes`. Сравнение идёт
через `timingSafeEqual`, чтобы время ответа не зависело от того, в каком
байте подписи расхождение. При несовпадении юнит бросает отказ, и хендлер
не вызывается.

### Шаг 4. Декларация с `rawBody: true`

```typescript
// packages/examples.app-with-http/src/features/users/endpoints/user-webhook.endpoint.ts
export const userWebhookHandler =
  (users: UsersRepository) =>
  async (event: UserEventInput): Output<UserEventOutput> => {
    await users.remove(event.userId);

    return { received: true };
  };

export const UserWebhook = httpEndpoint({
  method: 'POST',
  path: '/hooks/users',
  input: UserEventInput,
  output: UserEventOutput,
  errors: [InvalidSignature],
  rawBody: true,
  detached:
    'webhook: подлинность проверяется подписью тела, а не bearer-токеном',
  doc: { summary: 'Webhook о событиях пользователя', tags: ['users'] },
  // Слой с требованием к стартовому контексту стоит снаружи: его
  // требование выполняет транспорт, а не соседний слой
  pipeline: compose(
    makePipeline<{ rawBody: Uint8Array }>().pre(VerifySignature),
    observability,
  ),
  handler: {
    deps: [UsersRepository$],
    handle: userWebhookHandler,
  },
});
```

В декларации четыре новых элемента.

`rawBody: true` включает доступ к байтам тела. Транспорт читает тело один
раз: те же байты уходят в `ctx.input.rawBody` для юнита и разбираются в
JSON для схемы `input`. Хендлер получает обычный проверенный payload и о
байтах не знает.

`makePipeline<{ rawBody: Uint8Array }>()` объявляет требование слоя к
стартовому контексту. Слой стоит первым аргументом `compose`: его
требование выполняет транспорт, а внешнего слоя, который положил бы
`rawBody`, нет. Слой `observability` стоит вторым и получает контекст, в
котором подпись уже проверена.

`errors: [InvalidSignature]` объявляет отказ, который бросает юнит, а не
хендлер. Правило из [главы 9](./09-auth.md) действует и здесь: список
`errors:` описывает всё, что может получить клиент.

`detached` выводит endpoint из-под всех политик сборки с причиной.
Политика из `root.ts` требует слой `authed` от каждого `POST`, а
подлинность здесь подтверждает подпись. Причина печатается при старте и
попадает в отчёт `check()`:

```
[nestling] detached from policies: POST /hooks/users (http) — webhook: подлинность проверяется подписью тела, а не bearer-токеном
```

### Запросы

Подпись считается тем же алгоритмом, что в юните: HMAC-SHA256 от байтов
тела, в hex.

```bash
API_TOKEN=secret WEBHOOK_SECRET=hook yarn workspace examples.app-with-http start:dev

body='{"type":"user.deleted","userId":"2"}'
sig=$(printf '%s' "$body" | openssl dgst -sha256 -hmac hook | sed 's/^.* //')

curl -X POST localhost:3000/hooks/users \
  -H 'content-type: application/json' -H "x-signature: $sig" -d "$body"
# {"received":true}                                                 200

curl -X POST localhost:3000/hooks/users \
  -H 'content-type: application/json' -H 'x-signature: deadbeef' -d "$body"
# {"error":"Webhook signature does not match the body","code":"unauthorized:invalid_signature"}  401

curl localhost:3000/users/2
# {"error":"User 2 not found","code":"not_found:user","details":{"id":"2"}}  404
```

Первый запрос прошёл проверку, и хендлер удалил пользователя. Второй
отклонён юнитом до хендлера. Строка аудита слоя `observability` есть в
обоих случаях: слой стоит внутри и видит исход запроса.

## Что гарантирует фреймворк

- Слой с требованием `{ rawBody: Uint8Array }` на декларации без
  `rawBody: true` не компилируется. Ошибка типа называет недостающее поле
  и способ починить:

  ```
  __error: "Pipeline requires context that the start context does not provide";
  missing: { rawBody: Uint8Array };
  hint: "declare 'rawBody: true', or provide the fields from an outer layer"
  ```

  Забытая пометка находится в редакторе, а не запросом с `500`.
- Тело читается один раз. Байты для подписи и значение для схемы берутся
  из одного буфера, и расхождения между ними быть не может.
- Отказ из pre-юнита проходит ту же проверку `errors:`, что и отказ
  хендлера. Незадекларированный отказ клиент получил бы как `internal_error`.
- `detached` требует причину. Пустая строка останавливает сборку, а
  причина печатается при старте и попадает в отчёт `check()`, поэтому
  список исключений из политик читается на ревью.

## Как проверить

```typescript
// packages/examples.app-with-http/e2e/webhook.spec.e2e.ts
const sign = (body: string, secret = E2E_WEBHOOK_SECRET): string =>
  createHmac('sha256', secret).update(body).digest('hex');

// …
it('принимает тело с верной подписью и применяет событие', async () => {
  const body = JSON.stringify({ type: 'user.deleted', userId: '2' });

  const response = await client.raw('POST', '/hooks/users', body, {
    'content-type': 'application/json',
    'x-signature': sign(body),
  });

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ received: true });
  const deleted = await client.get('/users/2');
  expect(deleted.status).toBe(404);
});

it('отклоняет тело с чужой подписью', async () => {
  const body = JSON.stringify({ type: 'user.deleted', userId: '1' });

  const response = await client.raw('POST', '/hooks/users', body, {
    'content-type': 'application/json',
    'x-signature': sign(body, 'wrong-secret'),
  });

  expect(response.status).toBe(401);
  expect(await response.json()).toMatchObject({ code: 'unauthorized:invalid_signature' });
  const kept = await client.get('/users/1');
  expect(kept.status).toBe(200);
});
```

Проверка подписи зависит от байтов тела, поэтому тест идёт по сети, а не
через `testApp.call`: app-тест принимает готовый payload и тело не
сериализует. Секрет в e2e-сборке привязан источником к ключам секции
(`e2e/helpers/create-test-app.ts`), `process.env` тест не трогает.

```bash
yarn workspace examples.app-with-http test:e2e
```

## Запускаемый код

- `packages/examples.app-with-http/src/features/users/endpoints/user-webhook.endpoint.ts`
  — юнит `VerifySignature`, хендлер и декларация.
- `packages/examples.app-with-http/src/features/users/users.errors.ts` —
  отказ `InvalidSignature`.
- `packages/examples.app-with-http/src/app.config.ts` — секрет
  `WEBHOOK_SECRET`.
- `packages/examples.app-with-http/e2e/webhook.spec.e2e.ts` — тест по
  сети.

```bash
API_TOKEN=secret WEBHOOK_SECRET=hook yarn workspace examples.app-with-http start:dev
yarn workspace examples.app-with-http test:e2e
```

## Дальше

Те же декларации и пайплайн в командной строке:
[глава 20](./20-cli.md).
