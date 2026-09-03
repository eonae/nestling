# @nestling/client

Типизированный HTTP-клиент из операций. `makeClient(record, config)`
возвращает объект API, метод которого вызывается так же, как порт
операции: `Ok | Fail` для `request`, `Promise<void>` для `command`.

> 🚧 Активная разработка, API может меняться.
> Дизайн: [`docs/design/operations.md`](../../docs/design/operations.md) §5.
> Гайд: [глава 10. Отдать фронтенду документацию и клиент](../../docs/guide/10-openapi-and-client.md).

## Установка

```bash
npm install @nestling/client
```

Пакет зависит только от [`@nestling/operations`](../nestling.operations) и
глобального `fetch`; Node-специфичных API в нём нет, поэтому он
собирается для браузера. Замыкание импортов проверяет тест границы.

## Минимальный пример

```typescript
import { CreateUser, GetUser } from '@acme/billing-operations';
import { makeClient } from '@nestling/client';

const api = makeClient(
  { createUser: CreateUser, getUser: GetUser },     // имена методов задаёте вы
  { baseUrl, headers: () => ({ authorization: `Bearer ${token()}` }) },
);

const created = await api.createUser({ name: 'Alice', email: 'a@b.c' });

if (EmailTaken.is(created)) {
  // details типизированы схемой из defineFail; отказ узнаётся по code
} else if (created.isFail) {
  // множество ответов закрыто: объявленные отказы плюс UnknownError
} else {
  created.value.id;
}
```

## Что делает клиент

- Собирает запрос по bind-карте операции — обратная операция к разбору
  запроса транспортом. Path-параметры подставляются через
  `encodeURIComponent`; остальные поля идут в query или тело по правилу
  карты. Что клиент собрал, транспорт разбирает в исходный payload; это
  покрыто тестом.
- Проверяет успешный ответ по форме `output` операции через
  `~standard.validate`. По умолчанию проверка включена; отключается опцией
  `validateOutput: false`.
- Восстанавливает объявленные отказы по `code` из `errors:`. Статус
  берётся из определения, сообщение из ответа, детали из ответа с
  проверкой по схеме определения. Всё остальное — сетевая ошибка, не-JSON
  тело, незадекларированный код, детали не по схеме — становится
  `UnknownError` с оригиналом в `cause`.
- Истёкший `deadline` даёт отказ `DeadlineExceeded` до отправки запроса.
- Не бросает исключений на сетевые ошибки и отказы операции у
  `request`-операции. Исключение возможно только при неверном
  использовании, например для query-значения, которое нельзя записать в
  URL.

## Проверки при создании

`makeClient` бросает `TypeError` сразу, называя ключ метода: операция без
секции `http:`, операция вида `event`, потоковая (`stream`, `events`) или
`multipart` форма io, не-JSON тело (`'binary'`, `'text'`), неабсолютный
`baseUrl`. Отложенной диагностики «упадёт на первом вызове» нет.

## Справочник

### `ClientConfig`

| Поле | Что делает |
|---|---|
| `baseUrl` | абсолютный адрес сервиса; склеивается с путём операции буквально |
| `headers` | заголовки для всех вызовов: объект или функция, вызываемая на каждый запрос (для ротируемого токена) |
| `fetch` | реализация `fetch`; по умолчанию глобальная. Подмените её в тестах, чтобы обойтись без сети |
| `validateOutput` | проверять ли успешный ответ по схеме `output`; по умолчанию `true` |

### `ClientMeta` (второй аргумент метода)

| Поле | Что делает |
|---|---|
| `signal` | `AbortSignal`, отменяющий запрос |
| `deadline` | момент (`Date`), после которого вызов не отправляется |

### Типы

`Client<R>`, `ClientMethod<C>`, `ClientArgs<C>`, `ClientResult<C>`,
`ClientFail`, `ClientHeaders`.

## Границы пакета

Пакет не поддерживает потоковые и multipart-операции, события и
`idempotencyKey`.
