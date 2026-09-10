# @nestlingjs/operations

Декларации, общие для сервера и клиента: операции, отказы, `Ok`/`Fail` и
статусы, формы io, HTTP bind-карта и комбинаторы потоков. Пакет не
импортирует серверный код, контейнер и модули Node, поэтому его можно
импортировать во фронтенд — это проверяет тест границы.

> 🚧 Активная разработка, API может меняться.
> Дизайн: [`docs/design/operations.md`](../../docs/design/operations.md),
> [`docs/design/streaming.md`](../../docs/design/streaming.md).
> Гайд: [глава 13. Соседняя фича вызывает операцию](../../docs/guide/13-features.md),
> [глава 12. Отдать фронтенду документацию и клиент](../../docs/guide/12-openapi-and-client.md).

## Установка

```bash
npm install @nestlingjs/operations
```

## Минимальный пример

```typescript
import { makeFail, makeRequest, query } from '@nestlingjs/operations';

export const EmailTaken = makeFail('conflict:email_taken', {
  details: z.object({ email: z.string() }),
  message: (d) => `Email ${d.email} already taken`,
});

export const CreateUser = makeRequest({
  name: 'users.create', // subject шины
  http: { method: 'POST', path: '/users', bind: { dryRun: query() } },
  input: CreateUserInput,
  output: User,
  errors: [EmailTaken],
  doc: { summary: 'Create user', tags: ['users'], status: 'created' },
});
```

Операция — значение: она ничего не регистрирует. В приложение она попадает
двумя способами: её реализует `implement` из `@nestlingjs/app`, а вызыватель
`CreateUser.caller` инжектится DI-токеном.

## Экспорты

- **Операция** ([design](../../docs/design/operations.md)) — `AnyOperation`,
  `assertDoc`, `CommandMeta`, `CommandOperation`, `DeclarationDoc`, `Emitter`,
  `EmitterFamily`, `EmitterToken`, `EmittingOperation`, `EventOperation`,
  `InputFormOf`, `InputOf`, `InvokeArgs`, `KernelPortFail`, `lookupOperation`,
  `makeCommand`, `makeEvent`, `makeRequest`, `MetaOf`, `Operation`,
  `OperationFailsOf`, `OperationKind`, `OperationSpec`, `OutputFormOf`,
  `OutputOf`, `Port`, `PortFamily`, `PortMeta`, `PortResult`, `PortToken`,
  `RequestOperation`, `ValidateOperationFails`.
- **Результат и отказы** ([design](../../docs/design/errors.md)) — `AnyFail`,
  `AnyFailDefinition`, `assertFailCode`, `BadRequest`, `categories`, `Category`,
  `categoryOf`, `DeclaredFail`, `Fail`, `FailCode`, `FailCreateOptions`,
  `FailData`, `FailDefinitionProps`, `FailDefinitionWithDetails`,
  `FailDefinitionWithoutDetails`, `FailOf`, `FailOfDef`, `FailOptions`,
  `FailResponseOf`, `FailsOf`, `FailSpecWithDetails`, `FailSpecWithoutDetails`,
  `InternalError`, `isCategory`, `isFail`, `isFailDefinition`,
  `isKernelFailCode`, `KernelFail`, `makeFail`, `Ok`, `Output`, `OutputSync`,
  `PayloadTooLarge`, `ProcessingStatus`, `ResponseLike`, `statuses`,
  `SuccessStatus`, `successStatuses`, `Timeout`.
- **Формы io** ([design](../../docs/design/endpoints.md)) — `AnyInput`,
  `AnyMultipartForm`, `AnyOutput`, `AnyPayload`, `AnyStreamForm`,
  `assertFormSlots`, `assertFormsSupported`, `BindableFields`, `ChainStep`,
  `describeForm`, `EmptyInput`, `events`, `FilePart`, `FilesOf`,
  `FormBearingDefinition`, `FormDescriptor`, `FormKind`, `FormLeaf`, `FormSlot`,
  `InferInput`, `InferOutput`, `IOPrimitive`, `isForm`, `isPrimitiveLeaf`,
  `isStreamKind`, `isUploadSpec`, `ItemOptions`, `LeafType`, `makeSummary`,
  `mediaTypeOf`, `multipart`, `MultipartForm`, `nameOfForm`, `stream`,
  `StreamForm`, `StreamFormOptions`, `StreamKind`, `StreamSummary`,
  `TransportCapabilities`, `upload`, `UploadOptions`, `UploadSpec`,
  `ValidateOutputForm`.
- **HTTP-адрес** ([design](../../docs/design/transports.md)) — `assertHttpPath`,
  `BindMap`, `BindMark`, `BindPlace`, `BindPlacement`, `body`,
  `buildHttpBinding`, `computeHttpBinding`, `ComputeHttpBindingOptions`,
  `HttpBinding`, `HttpMethod`, `isBindMark`, `isHttpBinding`,
  `METHODS_WITHOUT_BODY`, `PathParams`, `query`, `readPathParams`,
  `RedirectStatus`, `SseConfig`.
- **Схемы** ([design](../../docs/design/schemas.md)) — `assertConverters`,
  `jsonSchema`, `jsonSchemaOf`, `leafJsonSchema`, `LeafJsonSchema`,
  `pickConverter`, `SchemaDocConverter`, `SchemaDocOptions`, `schemaVendorOf`.
- **Потоки** ([design](../../docs/design/streaming.md)) — `batch`, `collect`,
  `filter`, `gapTimeout`, `limit`, `tap`, `throttle`, `Topic`, `untilAborted`.
- **Ответ транспорта** — `isTransportResponse`, `TRANSPORT_RESPONSE`,
  `TransportResponse`.
- **Реэкспорт [`@nestlingjs/common.misc`](../common.misc/)** — типы Standard Schema, чтобы
  клиенту и генератору документации не ставить пакет спецификации.

## Границы пакета

Пакет описывает операции и не выполняет их. Реализация, контейнер, пайплайн
и транспорты живут в `@nestlingjs/app` и пакетах транспортов.
