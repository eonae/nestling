# @nestlingjs/client

Типизированный HTTP-клиент из деклараций операций. `makeClient(record, config)`
возвращает объект API, метод которого вызывается так же, как порт операции:
`Ok | Fail` для `request`, `Promise<void>` для `command`. Пакет зависит только
от `@nestlingjs/operations` и глобального `fetch`, поэтому собирается для
браузера.

> 🚧 Активная разработка, API может меняться.
> Дизайн: [`docs/design/operations.md`](../../docs/design/operations.md) §5.
> Гайд: [глава 12. Отдать фронтенду документацию и клиент](../../docs/guide/12-openapi-and-client.md).

## Установка

```bash
npm install @nestlingjs/client
```

## Минимальный пример

```typescript
import { CreateUser, GetUser } from '@acme/billing-operations';
import { makeClient } from '@nestlingjs/client';

const api = makeClient(
  { createUser: CreateUser, getUser: GetUser }, // имена методов задаёте вы
  { baseUrl, headers: () => ({ authorization: `Bearer ${token()}` }) },
);

const created = await api.createUser({ name: 'Alice', email: 'a@b.c' });

if (EmailTaken.is(created)) {
  // details типизированы схемой из makeFail; отказ узнаётся по code
} else if (created.isFail) {
  // множество ответов закрыто: объявленные отказы плюс InternalError
} else {
  created.value.id;
}
```

## Экспорты

| Имя | Что делает |
|---|---|
| `makeClient` | собирает объект API из записи операций и конфигурации |
| `Client` | тип собранного объекта API |
| `ClientConfig` | `baseUrl`, `headers`, своя реализация `fetch`, `validateOutput` |
| `ClientMeta` | второй аргумент метода: `signal` и `deadline` |
| `ClientMethod` | тип одного метода клиента |
| `ClientArgs` | аргументы метода, выведенные из операции |
| `ClientResult` | результат метода, выведенный из операции |
| `ClientFail` | отказ клиента: объявленный операцией либо `InternalError` |
| `ClientHeaders` | заголовки: объект либо функция на каждый запрос |

`makeClient` бросает `TypeError` сразу, называя ключ метода: операция без
секции `http:`, операция вида `event`, потоковая или `multipart` форма io,
не-JSON тело, неабсолютный `baseUrl`.

## Границы пакета

Клиент не поддерживает потоковые и multipart-операции, события и
`idempotencyKey`.
