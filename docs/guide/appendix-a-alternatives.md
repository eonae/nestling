# Приложение А. Альтернативные формы

> Каждая форма показана в одном месте примера `examples.app-with-http` (2026-09-03).

Главы гайда используют одну форму записи для каждой задачи. Фреймворк
допускает и другие. Здесь они собраны в одном месте: где показана
альтернатива и когда её выбирать.

| Задача | Форма по умолчанию | Альтернатива | Где показана |
|---|---|---|---|
| Зависимости хендлера | каррированная фабрика с `deps` | класс-хендлер | `features/users/endpoints/export-users.endpoint.ts` |
| Отказ из хендлера | `return Fail` | `meta.fail(Fail)` | `features/users/endpoints/update-user.endpoint.ts` |
| Отказ из юнита | `return Fail` из хендлера | `throw Fail` из pre-юнита | `plugins/auth/authenticate.ts`, `user-webhook.endpoint.ts` |
| Реакция на ошибку | `.finally` с `outcome` | `.catch` с `.is()` | `features/users/endpoints/delete-user.endpoint.ts` |
| Подмена успешного ответа | хендлер формирует ответ | `.ok`-юнит | в примере нет |
| Размещение поля запроса | правило по методу и `query()` | `body()` | в примере нет |
| Успех без тела | голое значение | `Ok.noContent()`, `Ok.accepted()` | `delete-user.endpoint.ts` |
| Состав фичи | `providers:` | `modules:` | `features/users/users.feature.ts` |
| Выбор фич | объект `{ features, includeDeps }` | строка через запятую | `packages/nestling.app/README.md` |

## Класс-хендлер

```typescript
// packages/examples.app-with-http/src/features/users/endpoints/export-users.endpoint.ts
@Injectable([UsersRepository$])
export class ExportUsersHandler {
  constructor(private readonly users: UsersRepository) {}

  async handle(): Output<AsyncIterableIterator<User>> {
    // …
  }
}

export const ExportUsers = httpEndpoint({
  method: 'GET',
  path: '/users/export',
  output: stream(User).limit(MAX_ROWS),
  doc: { summary: 'Выгрузка пользователей в NDJSON', tags: ['users'] },
  pipeline: observability,
  handle: ExportUsersHandler,
});
```

Класс с `@Injectable` и методом `handle` передаётся в `handle:` вместо
функции. Поля `deps` у декларации нет: зависимости объявляет сам класс.
Класс регистрируется в `providers:` модуля, как любой провайдер, и
контейнер создаёт его при сборке. Сигнатура `handle` сверяется со схемами
в точке декларации, `implements` не нужен.

Выбирайте эту форму, когда у хендлера есть состояние между вызовами или
несколько приватных методов. Для хендлера из одной функции каррированная
фабрика короче.

## Ранний выход через `meta.fail`

```typescript
// packages/examples.app-with-http/src/features/users/endpoints/update-user.endpoint.ts
export const updateUserHandler =
  (users: UsersRepository) =>
  async (
    payload: UpdateUserInput,
    meta: { fail: (e: UpdateUserFails) => never },
  ): Output<User, UpdateUserFails> => {
    const { id, ...changes } = payload;

    if (Object.keys(changes).length === 0) {
      meta.fail(NothingToUpdate());
    }

    if (changes.email) {
      const existing = await users.byEmail(changes.email);
      if (existing && existing.id !== id) {
        meta.fail(EmailTaken({ email: changes.email }));
      }
    }

    const user = await users.patch(id, changes);
    if (!user) {
      meta.fail(UserNotFound({ id }));
    }

    return user;
  };
```

`meta.fail` принимает только отказы из `errors:` декларации и возвращает
`never`. Компилятор считает код после вызова недостижимым, поэтому
`return user` ниже типизируется как `User`, а не `User | null`.

Выбирайте эту форму, когда отказов несколько и они лежат в глубине
ветвлений. Для одного отказа `return Fail` читается проще.

## Отказ броском из юнита

```typescript
// packages/examples.app-with-http/src/plugins/auth/authenticate.ts
    if (token === undefined || token !== this.config.apiToken) {
      throw Unauthorized();
    }
```

У pre-юнита нет канала возврата отказа: его возвращаемое значение
добавляется в контекст. Поэтому юнит бросает отказ. Для ответа возврат и
бросок неразличимы: рантайм останавливает пайплайн, хендлер не
вызывается, ответная фаза получает этот `Fail`. Отказ юнита объявляет в
`errors:` endpoint, как в [главе 8](./08-auth.md).

Хендлер тоже может бросить отказ, и обработка будет той же. В примере
хендлеры возвращают отказ значением: так тип возвращаемого значения
описывает все исходы, а бросок компилятор не видит.

## Слой `.catch` с проверкой по коду

```typescript
// packages/examples.app-with-http/src/features/users/endpoints/delete-user.endpoint.ts
@Injectable([Logger$])
export class AuditDeletion {
  constructor(private readonly logger: Logger) {}

  handle(res: ErrorResponseContext): void {
    if (UserNotFound.is(res.value)) {
      this.logger.log(`[audit] delete refused: ${res.value.message}`);
    }
  }
}

// …
  pipeline: compose(authed, makePipeline().catch(AuditDeletion)),
```

`.catch`-юнит вызывается только для ответа-ошибки. В него приходит
контекст ответа, а не сам `Fail`, поэтому отказ узнаётся через `.is()`.
Юнит, который ничего не возвращает, оставляет ответ без изменений.
Вернуть другой `Fail` можно; превратить ошибку в успех нельзя.

Выбирайте `.catch`, когда реакция нужна только на ошибки и зависит от
кода отказа. Для аудита всех исходов подходит `.finally` из
[главы 7](./07-logging.md).

## `.ok`-юнит

В примере `.ok`-юнита нет. По README `@nestling/pipeline` он вызывается
только для успешного ответа и видит полный контекст: успех означает, что
все `.pre`-юниты выполнились. Юнит может вернуть другой успешный ответ,
например добавить заголовок, или ничего не вернуть и оставить ответ как
есть. Заменить успех на ошибку через `.ok` нельзя. Проверка `errors:`
выполняется после `.ok` и `.catch`, до `.finally`.

Выбирайте `.ok`, когда заголовок или преобразование ответа нужны
нескольким endpoint'ам и не должны повторяться в хендлерах.

## Пометка `body()`

В примере поле `dryRun` вынесено из тела в query пометкой `query()` в
операции `api/operations.ts`. Обратная пометка `body()` переносит поле в
тело для метода, у которого поля по умолчанию идут в query. Обе пометки
описаны в README `@nestling/operations`, раздел про секцию `http:`.
Применяйте `body()` только когда контракт с клиентом уже сложился и
правило размещения из [главы 2](./02-input.md) ему не соответствует.

## `Ok.noContent()` и `Ok.accepted()`

```typescript
// packages/examples.app-with-http/src/features/users/endpoints/delete-user.endpoint.ts
    return removed ? Ok.noContent() : UserNotFound({ id: payload.id });
```

Голое значение из хендлера отвечает `200`. `Ok.created(value, headers)`
отвечает `201`, `Ok.noContent()` отвечает `204` без тела,
`Ok.accepted(value)` отвечает `202`. Статус успеха для документа OpenAPI
называется в `doc.status`, как у `DeleteUser`.

## `providers:` и `modules:` у фичи

```typescript
// packages/examples.app-with-http/src/features/quotas/quotas.feature.ts
export const QuotasFeature = makeFeature({
  name: 'quotas',
  providers: [QuotaService, SignupJournal],
  endpoints: [ClaimQuotaImpl, UserRegisteredInQuotas, SignupRecordedImpl],
});
```

```typescript
// packages/examples.app-with-http/src/features/users/users.feature.ts
export const UsersFeature = makeFeature({
  name: 'users',
  modules: [UsersModule],
  endpoints: [
    // …
  ],
});
```

Фича перечисляет провайдеры напрямую или через модули `makeModule`.
Модуль группирует провайдеры под именем и может объявлять `dependsOn`.
Пока провайдеров немного, `providers:` короче. Когда фича растёт и
провайдеры делятся на группы, которые нужны друг другу, переходите на
`modules:`. Endpoint'ы в обоих случаях перечисляет фича.

## `select` строкой

`select` принимает четыре формы: `'all'`, строку через запятую
`'users,ops'`, массив `['users', 'ops']` и объект
`{ features, includeDeps }`. Пример читает строку из `APP_FEATURES` и
оборачивает её в объект ради `includeDeps`, как показывает
[глава 15](./15-select.md). Строка без объекта подходит, когда замыкание
по вызовам не нужно: все нужные фичи названы явно.
