# 15. Тестировать фичу без соседей

> Гайд по текущему API; сверено с кодом `examples.app-with-http`, `examples.split-nats` (2026-09-05).
> Целевое описание: [design/testing.md](../design/testing.md) §3 и §4.
> Почему так: запись [ideas.md](../decisions/ideas.md) «[2026-07-10] Пакет
> тестирования (`@nestling/testing`)».

Фича `users` вызывает `quotas.claim` и отправляет `users.registered` и
`quotas.record-signup`. Команда квот ещё не написала реализацию, а тесты
регистрации нужны сейчас. И наоборот: фичу нужно проверить одну, без
соседей, так, чтобы тест не зависел от их кода и от брокера.

Основа из главы [7](./07-testing.md) считается известной: `assembleTest`,
`testApp.call`, `unwrap`, `overrides` и `vars`.

## Соберите одну фичу без соседей

```typescript
// packages/examples.split-nats/src/isolated.spec.ts (фрагмент)
const isolated = makeApp({ features: [UsersFeature, QuotasFeature] });

await using testApp = await assembleTest(isolated, { select: 'users' });
```

Поле `select` в тестовой сборке работает так же, как в корне: в графе
остаются только выбранные фичи. Такая сборка останавливается на фазе
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

Вызыватель `ClaimQuota.caller` в зависимостях фичи `users` требует
владельца операции. В сборке из одной фичи владельца нет, и его место
занимает стаб.

## Стабы вместо соседних операций

```typescript
// packages/examples.split-nats/src/isolated.spec.ts
  it('регистрирует пользователя через стабы соседних операций', async () => {
    const claimed: { email: string }[] = [];
    const registered: { id: string; email: string }[] = [];

    await using testApp = await assembleTest(isolated, {
      select: 'users',
      // Ни владельца `quotas.claim`, ни подписчика `users.registered` в
      // сборке нет: обе стороны заменены стабами
      stubs: [
        stub(ClaimQuota, async (input) => {
          claimed.push(input);

          return { remaining: 1 };
        }),
        stub(UserRegistered, (input) => {
          registered.push(input);
        }),
      ],
    });
```

`stub(Operation, impl)` возвращает пару из токена вызывателя и фейка:
для `request` это `ClaimQuota.caller`, для `command` и `event` это
`.emitter`. Пара передаётся полем `stubs:`. Провайдер стаба имеет
приоритет над боевым рецептом вызывателя, поэтому проверка владельца не
срабатывает, и фича собирается — подмена узла, которого в графе нет,
сборку не останавливает. Стаб операции, у которой есть владелец в
выбранных фичах, тоже допустим: он имеет приоритет над владельцем.

`impl` получает payload с типом из схемы `input` операции и возвращает
значение с типом из `output`. Фейк, не подходящий операции, не
компилируется. Своего spy у стаба нет: в `impl` подходит обычная функция
или `jest.fn()`. Список застабанных операций доступен как
`testApp.stubbed`: имена по алфавиту.

Стаб не может разойтись с операцией и в рантайме. Вход проверяется формой
`input`, успешный ответ формой `output`. Если стаб `quotas.claim` вернёт
`{ left: 1 }` вместо `{ remaining }`, вызывающий получит отказ, а не
неверное значение:

```
{
  "isSuccess": false,
  "status": "BAD_REQUEST",
  "value": {
    "code": "bad_request",
    "details": [{ "message": "Invalid input: expected number, received undefined", "path": ["remaining"] }]
  }
}
```

Отказ из стаба обязан входить в `errors:` операции. Объявленный отказ
проходит как есть, так же, как пришёл бы от настоящего владельца:

```typescript
// packages/examples.split-nats/src/isolated.spec.ts (фрагмент)
      stubs: [
        // Отказ объявлен в `errors:` операции, поэтому стаб отдаёт его как
        // есть, так же, как настоящий владелец по сети
        stub(ClaimQuota, async () => QuotaExceeded({ limit: 100 })),
        stub(UserRegistered, (input) => {
          registered.push(input);
        }),
      ],
```

Незадекларированный код останавливает тест ошибкой с именем операции,
кодом и разрешённым набором, а не превращается в `InternalError`.
Исчерпанный `deadline` даёт `timeout` до вызова `impl`, а `emit` команды
всегда несёт `idempotencyKey`, как у боевого порта.

## Вызов и проверка через матрицу топологий

```typescript
// packages/examples.split-nats/src/isolated.spec.ts (фрагмент)
    const [{ subscriber, response }] = await testApp.emit(RegisterUser, {
      email: 'alice@example.com',
    });

    expect(subscriber).toBe('users.register');
    expect(response.isSuccess).toBe(true);
    expect(claimed).toEqual([{ email: 'alice@example.com' }]);
    expect(registered).toEqual([
      { id: expect.any(String), email: 'alice@example.com' },
    ]);
```

`testApp.emit(Operation, payload)` доставляет команду или событие каждому
подписчику в этом процессе через его полный пайплайн и возвращает список
доставок: имя подписчика и ответ. У события подписчиков может не быть,
тогда список пуст. У команды подписчик обязателен: без него `emit`
завершается ошибкой адресации со списком доступных subject'ов.
`request`-операцию через `emit` вызвать нельзя, это ошибка компиляции: у
неё владелец, а не подписчики.

Стаб эмиттера здесь не мешает. Стаб подменяет то, что фича отправляет
наружу, а `emit` ведёт сообщение снаружи внутрь.

Стаб делает тестовый граф меньше боевого: операцию, которую никто не
реализует, стаб скроет. Поэтому рядом со стабами стоит проверка честного
графа:

```typescript
// packages/examples.split-nats/src/isolated.spec.ts
  it('каждая застабанная операция реализована в одной из топологий', async () => {
    await using testApp = await assembleTest(isolated, {
      select: 'users',
      stubs: [
        stub(ClaimQuota, async () => ({ remaining: 1 })),
        // eslint-disable-next-line unicorn/no-useless-undefined
        stub(UserRegistered, () => undefined),
      ],
    });

    // Матрица проверяет граф без подстановок: стаб операции, которой не
    // реализует ни одна топология, здесь станет виден
    const topologies = await checkTopologies(app, ['all', 'users', 'quotas']);

    const published = new Set(
      topologies.flatMap(({ report }) =>
        report.operations.map(({ name }) => name),
      ),
    );

    expect(testApp.stubbed.filter((name) => !published.has(name))).toEqual([]);
    expect(testApp.stubbed).toEqual(['quotas.claim', 'users.registered']);
  });
```

`checkTopologies` собирает каждую топологию без подстановок и возвращает
отчёт с полем `operations`. Тест сравнивает `testApp.stubbed` с
объединением опубликованных операций.

## Подмена в app-тесте: контекст, граф, топологии

Хранилище читает `requestId` ридером `Ctx(RequestId)` из главы
[8](./08-logging.md). Ридер является узлом графа, поэтому подменяется тем
же списком `overrides`. `contextValue(Variable, value)` даёт ридер с
постоянным значением:

```typescript
// packages/examples.app-with-http/src/app.spec.ts
  it('contextValue подставляет значение переменной в тестовом корне', async () => {
    const spy = spyLogger();
    await using testApp = await assembleTest(app, {
      ...testConfig,
      overrides: [[Logger$, spy.logger], contextValue(RequestId, 'req-fixed')],
    });

    unwrap(await testApp.call(GetUser, { id: '1' }));

    expect(spy.lines).toContain('[req-fixed] byId 1');
  });
```

Слой `observability` по-прежнему кладёт свой `requestId` в контекст, но
сервис читает подставленное значение. Семейство токенов целиком
подменяет `familyOverride(Family, make)` в том же списке `overrides`.

```typescript
// packages/examples.app-with-http/src/app.spec.ts
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

  it('замыкает выбор по вызываемым операциям', async () => {
    await using testApp = await assembleTest(app, {
      ...testConfig,
      select: { features: 'users', includeDeps: true },
    });

    expect(testApp.features).toEqual(['users', 'quotas']);
  });
```

`testApp.get(token)` возвращает инстанс из собранного графа или `null`,
если узла в графе нет. `testApp.features` перечисляет выбранные фичи
после замыкания по вызовам.

Файл `isolated.spec.ts` целиком состоит из тестов этой главы: сборка
одной фичи, стабы с успехом и с отказом, `testApp.emit` и сверка
`testApp.stubbed` с матрицей. Тесты `contextValue` и состава графа лежат
в `app.spec.ts` примера `app-with-http`.

```bash
yarn workspace examples.split-nats test
yarn workspace examples.app-with-http test
```

Приложение в проде собирается так же, по частям: [16. Запускать только
часть фич](./16-select.md).
