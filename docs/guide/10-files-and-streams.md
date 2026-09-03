# 9. Файлы и большие выгрузки

> Гайд по текущему API; сверено с кодом `examples.users-service` (2026-09-03).
> Целевое описание: [design/endpoints.md](../design/endpoints.md) §5 и
> [design/streaming.md](../design/streaming.md). Почему так: записи
> [ideas.md](../decisions/ideas.md) «Стриминг: `stream(T)` ≠ `events(T)`,
> AbortSignal, источники событий» и «Два скоупа обработки: request-pipeline
> и item-цепочки».

## Задача

Три запроса не укладываются в «JSON туда, JSON обратно». Пользователь
загружает аватар: файл плюс поля формы. Администратор выгружает всех
пользователей файлом, который может не поместиться в память. Тот же
администратор загружает список пользователей из такого же файла, и
сервер должен обрабатывать его построчно, не дожидаясь конца.

## Решение

Вход и выход endpoint'а описывает форма io. До этой главы формой была
схема как есть: одно JSON-значение. Ещё две формы решают три задачи
выше.

| Форма | Что это | HTTP |
|---|---|---|
| схема | одно значение | `application/json` |
| `multipart({ fields, files })` | поля формы и файлы | `multipart/form-data` |
| `stream(T)` | конечный поток значений `T` | `application/x-ndjson` |

### Шаг 1. Файл в форме

```typescript
// packages/examples.users-service/src/users/endpoints/upload-avatar.endpoint.ts
import type { FilePart } from '@nestling/operations';
import { multipart, upload } from '@nestling/operations';

const MiB = 1024 * 1024;

// `id` приходит из path-параметра и подмешивается к полям формы
const AvatarFields = z.object({ id: z.string() });

@Injectable([UsersRepository$])
export class UploadAvatarHandler {
  constructor(private readonly users: UsersRepository) {}

  async handle(input: {
    fields: AvatarFields;
    files: { avatar: FilePart };
  }): Output<User, typeof UserNotFound | typeof AvatarRequired> {
    const { fields, files } = input;

    if (!files.avatar) {
      return AvatarRequired();
    }

    const avatarUrl = `/uploads/${fields.id}/${files.avatar.filename}`;
    const user = await this.users.patch(fields.id, { avatarUrl });

    return user ?? UserNotFound({ id: fields.id });
  }
}

export const UploadAvatar = httpEndpoint({
  method: 'POST',
  path: '/users/:id/avatar',
  input: multipart({
    fields: AvatarFields,
    files: {
      avatar: upload({ maxSize: 2 * MiB, mime: ['image/png', 'image/jpeg'] }),
    },
  }),
  output: User,
  errors: [UserNotFound, AvatarRequired, Unauthorized],
  doc: { summary: 'Загрузить аватар', tags: ['users'] },
  pipeline: authed,
  handler: UploadAvatarHandler,
});
```

Форма `multipart({ fields, files })` описывает запрос из двух частей.
Схема `fields` проверяет текстовые поля формы. Path-параметры добавляются
к ним, поэтому `id` из адреса попадает в `fields.id`. Объект `files`
перечисляет файловые поля; `upload()` объявляет одно из них.

Хендлер получает payload вида `{ fields, files }`. Файл приходит как
`FilePart`: имя поля, имя файла, MIME-тип и поток байтов
`stream: AsyncIterable<Uint8Array>`. Хендлер примера файл не читает и
сохраняет только путь.

Ограничения объявлены на самом поле и применяются во время разбора.

- Файл больше `maxSize` прерывает чтение и даёт `413`. Сервер не
  буферизует файл целиком, чтобы потом отказать.
- Файл с MIME-типом вне списка отклоняется с `400` до чтения его тела.
- Файловое поле, которого нет в `files`, отклоняется с `400`: форма
  закрыта.

Единственное, что форма не гарантирует, это наличие поля. Форма без
файла даёт `files.avatar` равным `undefined`, и хендлер отвечает
объявленным отказом `AvatarRequired`.

```bash
curl -X POST http://localhost:3000/users/1/avatar \
  -H 'authorization: Bearer secret' -F 'avatar=@photo.png;type=image/png'
# {"id":"1","name":"Alice","email":"alice@example.com","avatarUrl":"/uploads/1/photo.png"}
curl -X POST http://localhost:3000/users/1/avatar \
  -H 'authorization: Bearer secret' -F 'avatar=@notes.txt;type=text/plain'
# {"error":"File field 'avatar' expects one of image/png, image/jpeg, got 'text/plain'"} 400
```

Несколько файлов в одном поле объявляются как
`upload({ multiple: true })`; тогда хендлер получает `FilePart[]`.

### Шаг 2. Выгрузка потоком

```typescript
// packages/examples.users-service/src/users/endpoints/export-users.endpoint.ts
import { Ok, stream } from '@nestling/operations';

/** Верхняя граница строк одной выгрузки: сверх неё поток обрывается */
const MAX_ROWS = 100_000;

@Injectable([UsersRepository$])
export class ExportUsersHandler {
  constructor(private readonly users: UsersRepository) {}

  async handle(): Output<AsyncIterableIterator<User>> {
    return new Ok(this.rows(), {
      'Content-Disposition': 'attachment; filename="users.ndjson"',
    });
  }

  private async *rows(): AsyncIterableIterator<User> {
    for (const user of await this.users.all()) {
      yield user;
    }
  }
}

export const ExportUsers = httpEndpoint({
  method: 'GET',
  path: '/users/export',
  output: stream(User).limit(MAX_ROWS),
  doc: { summary: 'Выгрузка пользователей в NDJSON', tags: ['users'] },
  pipeline: observability,
  handler: ExportUsersHandler,
});
```

Форма `stream(User)` на выходе означает конечный поток пользователей.
Хендлер возвращает обычный `AsyncIterable`; транспорт отдаёт его как
NDJSON, по одному JSON-объекту на строку, с chunked-кодированием.
Заголовок `Content-Type` ставит форма. Свой заголовок хендлер добавляет
вторым аргументом `new Ok(value, headers)`.

Элементы отдаются по мере чтения клиентом: производитель не обгоняет
потребителя, и в памяти не накапливается вся выгрузка.

`.limit(n)` ограничивает число элементов. Это шаг item-цепочки: она
обрабатывает элементы потока по одному, в отличие от пайплайна, который
обрабатывает запрос целиком. На выходе допустимы только шаги, которые
сохраняют тип элемента, потому что оба конца цепочки зафиксированы
схемой `output`.

Слой `observability` работает и здесь. Юнит `.finally` вызывается после
того, как поток завершился или оборвался, поэтому исход в строке аудита
верный.

```bash
curl -N http://localhost:3000/users/export
# Content-Disposition: attachment; filename="users.ndjson"
# content-type: application/x-ndjson
#
# {"id":"1","name":"Alice","email":"alice@example.com"}
# {"id":"2","name":"Bob","email":"bob@example.com"}
```

### Шаг 3. Загрузка потоком

```typescript
// packages/examples.users-service/src/users/endpoints/import-users.endpoint.ts
import { stream } from '@nestling/operations';

const ImportResult = z.object({
  imported: z.number(),
  skipped: z.number(),
});

/** Больше строк за один запрос не принимается: ответ `413` */
const MAX_ROWS = 10_000;

/** Пауза между строками, после которой запрос отклоняется: ответ `504` */
const GAP_TIMEOUT_MS = 30_000;

@Injectable([UsersRepository$])
export class ImportUsersHandler {
  constructor(private readonly users: UsersRepository) {}

  async handle(rows: AsyncIterableIterator<ImportRow>): Output<ImportResult> {
    let imported = 0;
    let skipped = 0;

    for await (const row of rows) {
      if (await this.users.byEmail(row.email)) {
        skipped += 1;
        continue;
      }

      await this.users.insert(row);
      imported += 1;
    }

    return { imported, skipped };
  }
}

export const ImportUsers = httpEndpoint({
  method: 'POST',
  path: '/users/import',
  input: stream(ImportRow).limit(MAX_ROWS).gapTimeout(GAP_TIMEOUT_MS),
  output: ImportResult,
  errors: [Unauthorized],
  doc: { summary: 'Импорт пользователей из NDJSON', tags: ['users'] },
  pipeline: authed,
  handler: ImportUsersHandler,
});
```

Форма `stream(ImportRow)` на входе означает, что тело запроса читается
построчно как NDJSON. Хендлер получает `AsyncIterableIterator<ImportRow>`
и читает его циклом `for await` в своём темпе.

Каждую строку проверяет схема `ImportRow` до того, как строка попадёт в
хендлер. Невалидная строка обрывает запрос отказом `bad_request`
с кодом `400`; хендлер видит только проверенные значения. Схема строки —
`User.pick({ name: true, email: true })`: те же поля, что принимает
`POST /users`, без флага `dryRun`.

Два шага item-цепочки защищают сервер от клиента.

- `.limit(n)` обрывает запрос после `n` строк отказом
  `payload_too_large`, код `413`.
- `.gapTimeout(ms)` обрывает запрос, если следующая строка не пришла за
  `ms` миллисекунд, отказом `timeout`, код `504`.

Оба кода принадлежат ядру. Объявлять их в `errors:` не нужно: они
входят в список ответов каждого endpoint'а, и граница пайплайна не
заменяет их на `internal_error`.

```bash
printf '{"name":"Dan","email":"dan@example.com"}\n{"name":"Alice","email":"alice@example.com"}\n' > rows.ndjson
curl -X POST http://localhost:3000/users/import \
  -H 'authorization: Bearer secret' -H 'content-type: application/x-ndjson' \
  --data-binary @rows.ndjson
# {"imported":1,"skipped":1}
printf '{"name":"Eve","email":"not-an-email"}\n' | curl -X POST http://localhost:3000/users/import \
  -H 'authorization: Bearer secret' -H 'content-type: application/x-ndjson' --data-binary @-
# {"error":"Bad request","code":"bad_request","details":[{"message":"Invalid email address","path":["email"]}]} 400
```

Проверку элементов можно ослабить в самой форме: `stream(ImportRow,
{ onInvalid: 'skip' })` пропускает невалидные строки, а
`{ validate: false }` отключает проверку. По умолчанию невалидная строка
обрывает запрос.

## Что гарантирует фреймворк

- Тип payload хендлера выводится из формы. Для `multipart` это
  `{ fields, files }` с типами по схеме `fields` и объявленным файлам,
  для `stream(T)` на входе это `AsyncIterableIterator<T>`.
- Шаг, который меняет тип элемента, например `.batch(100)`, на выходе не
  компилируется: схема `output` описывает элемент, который уходит по
  сети.
- Лимиты файлов и потоков срабатывают во время чтения. Тело сверх лимита
  не буферизуется.
- Форма `multipart` закрыта: незаявленное файловое поле и второй файл в
  поле без `multiple` дают `400`.

## Как проверить

В `src/app.spec.ts` тестов на эти три endpoint'а нет, потому что разбор
формы и NDJSON выполняет транспорт, а `testApp.call` принимает готовый
payload. Проверить их можно двумя способами.

Первый: команды `curl` из этой главы на запущенном сервере.

Второй: app-тест с готовым `AsyncIterable`. Проверка элементов схемой и
item-цепочка при этом выполняются, как при запросе по сети:

```typescript
// иллюстрация; в src/app.spec.ts этого теста нет
it('импортирует строки и пропускает занятые email', async () => {
  await using testApp = await assembleTest(app, {
    overrides: [[UsersRepository$, inMemoryUsersRepo([alice])]],
  });

  async function* rows() {
    yield { name: 'Dan', email: 'dan@example.com' };
    yield alice;
  }

  const result = await testApp.call(ImportUsers, rows(), {
    attributes: { authorization: 'Bearer test-token' },
  });

  expect(unwrap(result)).toEqual({ imported: 1, skipped: 1 });
});
```

Для `ExportUsers` значение `unwrap(await testApp.call(ExportUsers))` является
`AsyncIterable`, который читается тем же `for await`.

## Пока не нужно

- Открытая подписка, которая не заканчивается, пока клиент подключён,
  объявляется формой `events(T)` и отдаётся как SSE. Это
  [глава 14](./14-live-feed.md).
- Шаги item-цепочки `.tap`, `.filter` и `.batch` на входе, где тип
  элемента менять можно, описаны в
  [приложении А](./appendix-a-alternatives.md).
- Сырые байты тела для проверки подписи webhook'а запрашиваются
  полем `rawBody: true`. Это [глава 19](./19-webhook.md).

## Запускаемый код

- `packages/examples.users-service/src/users/endpoints/upload-avatar.endpoint.ts`
  — форма `multipart` и `upload`.
- `packages/examples.users-service/src/users/endpoints/export-users.endpoint.ts`
  — `stream(T)` на выходе.
- `packages/examples.users-service/src/users/endpoints/import-users.endpoint.ts`
  — `stream(T)` на входе с `.limit` и `.gapTimeout`.
- `packages/examples.users-service/src/users/users.errors.ts` — отказ
  `AvatarRequired`.

```bash
API_TOKEN=secret yarn workspace examples.users-service start:dev
curl -N http://localhost:3000/users/export
curl -X POST http://localhost:3000/users/1/avatar \
  -H 'authorization: Bearer secret' -F 'avatar=@photo.png;type=image/png'
curl -X POST http://localhost:3000/users/import \
  -H 'authorization: Bearer secret' -H 'content-type: application/x-ndjson' \
  --data-binary @rows.ndjson
```

## Дальше

Документ OpenAPI и типизированный клиент из тех же деклараций:
[глава 11](./11-openapi-and-client.md).
