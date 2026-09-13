# 12. Files and large exports

> Guide to the current API; verified against `76ea1866`.
> Target description: [design/endpoints.md](../design/endpoints.md) §5 and
> [design/streaming.md](../design/streaming.md). Why: entries
> [ideas.md](../../decisions/ideas.md)
> `Стриминг: stream(T) ≠ events(T), AbortSignal, источники событий` and
> `Два скоупа обработки: request-pipeline и item-цепочки`.

Three requests do not fit into "JSON in, JSON back." A user uploads an
avatar: a file plus form fields. An administrator exports every user as a
file that may not fit in memory. The same administrator uploads a list of
users from such a file, and the server must process it line by line,
without waiting for the end.

The io shape describes the input and the output of an endpoint. Up to this
chapter the shape was the schema as it is: one JSON value. Two more shapes
solve the three tasks above.

| Shape | What it is | HTTP |
|---|---|---|
| schema | one value | `application/json` |
| `multipart({ fields, files })` | form fields and files | `multipart/form-data` |
| `stream(T)` | a finite stream of `T` values | `application/x-ndjson` |

## A file in the shape

```typescript
// src/users/endpoints/upload-avatar.endpoint.ts
import type { FilePart } from '@nestlingjs/operations';
import { multipart, upload } from '@nestlingjs/operations';

const MiB = 1024 * 1024;

// `id` comes from the path parameter and is mixed into the form fields
const AvatarFields = z.object({ id: z.string() });

@Handler([UsersRepository$])
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

export const UploadAvatar = httpEndpoint.post('/users/:id/avatar', {
  input: multipart({
    fields: AvatarFields,
    files: {
      avatar: upload({ maxSize: 2 * MiB, mime: ['image/png', 'image/jpeg'] }),
    },
  }),
  output: User,
  errors: [UserNotFound, AvatarRequired],
  doc: { summary: 'Загрузить аватар', tags: ['users'] },
  pipeline: transactional,
  handler: UploadAvatarHandler,
});
```

The `transactional` layer is from [chapter 11](./11-database.md): it opens
the request transaction and brings the Bearer token check along, because
it is composed from `authed`.

The `multipart({ fields, files })` shape describes a request made of two
parts. The `fields` schema checks the text fields of the form. The path
parameters are added to them, so `id` from the address ends up in
`fields.id`. The `files` object lists the file fields; `upload()` declares
one of them. The payload type of the handler is derived from the shape as
a whole: for `multipart` this is `{ fields, files }` with the types from
the `fields` schema and the declared files.

The handler gets a payload of the shape `{ fields, files }`. A file
arrives as a `FilePart`: the field name, the file name, the MIME type and
the byte stream `stream: AsyncIterable<Uint8Array>`. The handler of the
example does not read the file and only stores the path.

The limits are declared right on the field and apply during parsing,
before the whole body is buffered.

- A file larger than `maxSize` interrupts reading and gives `413`. The
  server does not buffer the whole file only to then reject it.
- A file with a MIME type outside the list is rejected with `400` before
  its body is read.
- The form is closed: a file field missing from `files` is rejected with
  `400`, and so is a second file in a field without `multiple: true`.

The one thing the shape does not guarantee is the presence of a field. A
form without a file gives `files.avatar` equal to `undefined`, and the
handler answers with the declared `AvatarRequired` failure.

```bash
API_TOKEN=secret yarn start:dev
curl -X POST http://localhost:3000/users/1/avatar \
  -H 'authorization: Bearer secret' -F 'avatar=@photo.png;type=image/png'
# {"id":"1","name":"Alice","email":"alice@example.com","avatarUrl":"/uploads/1/photo.png"}
curl -X POST http://localhost:3000/users/1/avatar \
  -H 'authorization: Bearer secret' -F 'avatar=@notes.txt;type=text/plain'
# {"error":"File field 'avatar' expects one of image/png, image/jpeg, got 'text/plain'"} 400
```

Several files in one field are declared as `upload({ multiple: true })`;
then the handler gets a `FilePart[]`.

## Exporting as a stream

```typescript
// src/users/endpoints/export-users.endpoint.ts
import { stream } from '@nestlingjs/operations';
import { HttpResponse } from '@nestlingjs/transport.http';

/** The upper bound of rows in one export: past it the stream cuts off */
const MAX_ROWS = 100_000;

@Handler([UsersRepository$])
export class ExportUsersHandler {
  constructor(private readonly users: UsersRepository) {}

  async handle(): HttpOutput<AsyncIterableIterator<User>> {
    return HttpResponse.of(this.rows(), {
      headers: { 'Content-Disposition': 'attachment; filename="users.ndjson"' },
    });
  }

  private async *rows(): AsyncIterableIterator<User> {
    for (const user of await this.users.all()) {
      yield user;
    }
  }
}

export const ExportUsers = httpEndpoint.get('/users/export', {
  output: stream(User).limit(MAX_ROWS),
  doc: { summary: 'Выгрузка пользователей в NDJSON', tags: ['users'] },
  pipeline: observability,
  handler: ExportUsersHandler,
});
```

The `stream(User)` shape on the output means a finite stream of users. The
handler returns an ordinary `AsyncIterable`; the transport gives it out as
NDJSON, one JSON object per line, with chunked encoding. The shape sets
the `Content-Type` header. The handler adds its own header with the
response form `HttpResponse.of(value, { headers })`; the transport writes
it before the first frame. Such a handler knows HTTP, so it lives in
`httpEndpoint`: the address is declared there by the transport
([chapter 10](./10-auth.md)).

Elements are given out as the client reads them: the producer does not
outrun the consumer, and the whole export does not build up in memory.

`.limit(n)` bounds the number of elements. This is a step of the item
chain: it processes the elements of the stream one at a time, unlike the
pipeline, which processes the request as a whole. Only steps that keep the
element type are allowed on the output, because both ends of the chain are
fixed by the `output` schema.

The `observability` layer works here too. The `.finally` unit is called
after the stream has finished or cut off, so the outcome in the audit line
is correct.

```bash
curl -N http://localhost:3000/users/export
# Content-Disposition: attachment; filename="users.ndjson"
# content-type: application/x-ndjson
#
# {"id":"1","name":"Alice","email":"alice@example.com"}
# {"id":"2","name":"Bob","email":"bob@example.com"}
```

## Importing as a stream

```typescript
// src/users/endpoints/import-users.endpoint.ts
import { stream } from '@nestlingjs/operations';

const ImportResult = z.object({
  imported: z.number(),
  skipped: z.number(),
});

/** No more rows are accepted in one request: the response is `413` */
const MAX_ROWS = 10_000;

/** The pause between rows after which the request is rejected: the response is `504` */
const GAP_TIMEOUT_MS = 30_000;

@Handler([UsersRepository$])
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

export const ImportUsers = httpEndpoint.post('/users/import', {
  input: stream(ImportRow).limit(MAX_ROWS).gapTimeout(GAP_TIMEOUT_MS),
  output: ImportResult,
  doc: { summary: 'Импорт пользователей из NDJSON', tags: ['users'] },
  pipeline: transactional,
  handler: ImportUsersHandler,
});
```

The `stream(ImportRow)` shape on the input means that the body of the
request is read line by line as NDJSON. The handler gets an
`AsyncIterableIterator<ImportRow>` and reads it in a `for await` loop at
its own pace — the same way the payload type is derived from the shape for
`stream(T)` on the input.

The `ImportRow` schema checks every row before it reaches the handler. An
invalid row cuts off the request with the `bad_request` failure at code
`400`; the handler sees only checked values. The row schema is
`User.pick({ name: true, email: true })`: the same fields that
`POST /users` accepts, without the `dryRun` flag.

Two steps of the item chain protect the server from the client, and both,
like the upload file limits, fire during reading: the body past the limit
does not build up in memory.

- `.limit(n)` cuts off the request after `n` rows with the
  `payload_too_large` failure, code `413`.
- `.gapTimeout(ms)` cuts off the request if the next row has not arrived
  within `ms` milliseconds, with the `timeout` failure, code `504`.

Both codes belong to the kernel. There is no need to declare them in
`errors:`: they are part of the response list of every endpoint, and the
pipeline boundary does not replace them with `internal_error`.

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

The check of the elements can be relaxed in the shape itself:
`stream(ImportRow, { onInvalid: 'skip' })` skips invalid rows, and
`{ validate: false }` turns the check off. By default an invalid row cuts
off the request.

## Check

There is no test for these three endpoints in `src/app.spec.ts`, because
the transport parses the shape and the NDJSON, and `testApp.call` accepts
a ready payload. There are two ways to check them.

The first: the `curl` commands from this chapter against a running
server.

The second: an app test with a ready `AsyncIterable`. The check of the
elements by the schema and the item chain still run, as they would for a
request over the network:

```typescript
// illustration; src/app.spec.ts has no such test
it('импортирует строки и пропускает занятые email', async () => {
  await using testApp = await assembleTest(app, {
    config: testConfig,
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

For `ExportUsers`, the value of `unwrap(await testApp.call(ExportUsers))`
is an `AsyncIterable`, read with the same `for await`.

The OpenAPI document and a typed client from the same declarations:
[chapter 13](./13-openapi-and-client.md).
