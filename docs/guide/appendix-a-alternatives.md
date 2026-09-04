# Приложение А. Альтернативные формы

> Каждая форма показана в одном месте примера `examples.app-with-http` (2026-09-05).

Главы гайда используют одну форму записи для каждой задачи. Фреймворк
допускает и другие. Здесь они собраны в одном месте: где показана
альтернатива и когда её выбирать.

| Задача | Форма по умолчанию | Альтернатива | Где показана |
|---|---|---|---|
| Отказ из хендлера | `return Fail` | `throw Fail` из глубины вызовов | `user-webhook.endpoint.ts` |
| Отказ из pre-юнита | `return Fail` с объявлением на слое | `throw Fail` из глубины вызовов | `plugins/auth/authenticate.ts` |
| Реакция на ошибку | `.finally` с `outcome` | `.catch` с `.is()` | `features/users/endpoints/delete-user.endpoint.ts` |
| Подмена успешного ответа | хендлер формирует ответ | `.ok`-юнит | в примере нет |
| Успех без тела | голое значение | `Ok.noContent()`, `Ok.accepted()` | `delete-user.endpoint.ts` |
| Состав фичи | `providers:` | `modules:` | `features/users/users.feature.ts` |
| Выбор фич | объект `{ features, includeDeps }` | строка через запятую | `packages/nestling.app/README.md` |

## Отказ из юнита

```typescript
// packages/examples.app-with-http/src/plugins/auth/authenticate.ts
    if (token === undefined || token !== this.config.apiToken) {
      return Unauthorized();
    }
// подключение юнита объявляет его отказы
makePipeline().pre(Authenticate, { errors: [Unauthorized] });
```

Канон — `return`, как у хендлера. Отказ объявляется вторым аргументом
`.pre`, и компилятор проверяет возврат по этому списку. Рантайм узнаёт
отказ до записи результата в контекст, поэтому в накопленный `input` он
не попадает. Как это работает — [глава 9](./09-auth.md).

| Форма | Видит компилятор | Где объявляется |
|---|---|---|
| `return Fail` из pre-юнита | да | второй аргумент `.pre` |
| `throw Fail` из pre-юнита | нет | `.pre` или `errors:` endpoint'а |
| `throw Fail` из глубины вызовов | нет | `errors:` endpoint'а или операции |

`throw` остаётся для доставки из глубины: сервис, у которого нет канала
возврата к границе, бросает отказ, и хендлер его не перехватывает. Для
ответа возврат и бросок неразличимы: рантайм останавливает пайплайн,
хендлер не вызывается, ответная фаза получает этот `Fail`. Компилятор
бросок не видит, поэтому такой отказ обязан быть объявлен: незадекларированный
рантайм заменит на `InternalError` (500).

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
[главы 8](./08-logging.md).

## `.ok`-юнит

В примере `.ok`-юнита нет. По README `@nestling/pipeline` он вызывается
только для успешного ответа и видит полный контекст: успех означает, что
все `.pre`-юниты выполнились. Юнит может вернуть другой успешный ответ,
например добавить заголовок, или ничего не вернуть и оставить ответ как
есть. Заменить успех на ошибку через `.ok` нельзя. Проверка `errors:`
выполняется после `.ok` и `.catch`, до `.finally`.

Выбирайте `.ok`, когда заголовок или преобразование ответа нужны
нескольким endpoint'ам и не должны повторяться в хендлерах.

## `Ok.noContent()` и `Ok.accepted()`

```typescript
// packages/examples.app-with-http/src/features/users/endpoints/delete-user.endpoint.ts
    return removed ? Ok.noContent() : UserNotFound({ id: input.id });
```

Голое значение из хендлера отвечает `200`. `Ok.created(value, headers)`
отвечает `201`, `Ok.noContent()` отвечает `204` без тела,
`Ok.accepted(value)` отвечает `202`. Статус успеха для документа OpenAPI
называется в `doc.status` (`'ok'`, `'created'`, `'accepted'`,
`'no_content'`), как у `DeleteUser`. Второй аргумент `Ok` — заголовки
ответа; они не зависят от транспорта, и что с ними делать, решает
транспорт.

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

## Выбор фич строкой

Аргумент `app.assemble(select)` принимает четыре формы: `'all'`, строку
через запятую `'users,ops'`, массив `['users', 'ops']` и объект
`{ features, includeDeps }`. Пример читает строку из `APP_FEATURES` и
оборачивает её в объект ради `includeDeps`, как показывает
[глава 16](./16-select.md). Строка без объекта подходит, когда замыкание
по вызовам не нужно: все нужные фичи названы явно.
