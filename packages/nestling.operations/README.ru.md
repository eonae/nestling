# @nestlingjs/operations

Декларации, общие для сервера и клиента: операции, отказы, `Ok`/`Fail` и
статусы, формы io, HTTP bind-карта и комбинаторы потоков. Пакет не
импортирует серверный код, контейнер и модули Node, поэтому его можно
импортировать во фронтенд — это проверяет тест границы.

> 🚧 Активная разработка, API может меняться.
> Дизайн: [`docs/design/operations.md`](../../docs/design/operations.md),
> [`docs/design/streaming.md`](../../docs/design/streaming.md).
> Гайд: [глава 14. Соседняя фича вызывает операцию](../../docs/guide/14-features.md),
> [глава 13. Отдать фронтенду документацию и клиент](../../docs/guide/13-openapi-and-client.md).

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
  status: 'created', // объявленный исход: ответ уходит кодом 201
  errors: [EmailTaken],
  doc: { summary: 'Create user', tags: ['users'] },
});
```

Операция — значение: она ничего не регистрирует. В приложение она попадает
двумя способами: её реализует `implement` из `@nestlingjs/app`, а вызыватель
`CreateUser.caller` инжектится DI-токеном.

## Экспорты

- **Операция** ([design](../../docs/design/operations.md)) — `AnyOperation`,
  `assertDoc`, `CommandOperation`, `DeclarationDoc`, `EmitMeta`, `Emitter`,
  `EmitterFamily`, `EmitterToken`, `EmittingOperation`, `errorsOf`, `EventOperation`,
  `HandlerResultOf`, `InputFormOf`, `InputOf`, `InvokeArgs`, `KernelPortFail`,
  `lookupOperation`, `makeCommand`, `makeEvent`, `makeRequest`, `MetaOf`,
  `Operation`, `OperationFailsOf`, `OperationKind`, `OperationSpec`, `OutputFormOf`,
  `OutputOf`, `Port`, `PortFamily`, `PortMeta`, `PortResult`, `PortToken`,
  `RequestOperation`, `StatusOf`, `UndeclaredHandlerFails`, `ValidateHandlerFails`,
  `ValidateOperationFails`.
- **Результат и отказы** ([design](../../docs/design/errors.md)) — `AnyFail`,
  `AnyFailDefinition`, `AnyOk`, `assertFailCode`, `assertSuccessStatus`,
  `BadRequest`, `categories`, `Category`, `categoryOf`, `DeclaredFail`, `DeclaredOk`,
  `DeclaredOutput`, `DeclaredOutputSync`, `DeclaredStatuses`, `EffectiveStatus`,
  `Fail`, `FailCode`, `FailCreateOptions`, `FailData`, `FailDefinitionProps`,
  `FailDefinitionWithDetails`, `FailDefinitionWithoutDetails`, `FailOf`, `FailOfDef`,
  `FailOptions`, `FailResponseOf`, `FailsOf`, `FailSpecWithDetails`,
  `FailSpecWithoutDetails`, `InternalError`, `isCategory`, `isFail`,
  `isFailDefinition`, `isKernelFailCode`, `isSuccessStatus`, `KernelFail`,
  `makeFail`, `Ok`, `OutcomeOks`, `Output`, `OutputSync`, `PayloadTooLarge`,
  `ProcessingStatus`, `ResponseLike`, `statuses`, `SuccessStatus`, `successStatuses`,
  `Timeout`.
- **Формы io** ([design](../../docs/design/endpoints.md)) — `AnyInput`,
  `AnyMultipartForm`, `AnyOutcomesForm`, `AnyOutput`, `AnyPayload`, `AnyStreamForm`,
  `assertFormsSupported`, `assertIoDeclaration`, `BindableFields`, `ChainStep`,
  `DeclaredOutcome`, `declaredOutcomes`, `describeForm`, `describeOutcomes`,
  `EmptyInput`, `events`, `FilePart`, `FilesOf`, `FormBearingDefinition`,
  `FormDescriptor`, `FormKind`, `FormLeaf`, `FormSlot`, `InferInput`, `InferOutput`,
  `IOPrimitive`, `isForm`, `isNone`, `isOutcomes`, `isPrimitiveLeaf`, `isStreamKind`,
  `isUploadSpec`, `ItemOptions`, `LeafType`, `makeSummary`, `mediaTypeOf`,
  `multipart`, `MultipartForm`, `nameOfForm`, `none`, `NoneForm`, `OutcomeForm`,
  `OutcomeMap`, `OutcomesForm`, `OutcomeValue`, `OutcomeValues`, `outputs`, `stream`,
  `StreamForm`, `StreamFormOptions`, `StreamKind`, `StreamSummary`,
  `TransportCapabilities`, `upload`, `UploadOptions`, `UploadSpec`,
  `ValidateOutputForm`.
- **HTTP-адрес** ([design](../../docs/design/transports.md)) — `assertHttpPath`,
  `BindMap`, `BindMark`, `BindPlace`, `BindPlacement`, `body`, `buildHttpBinding`,
  `computeHttpBinding`, `ComputeHttpBindingOptions`, `HttpBinding`, `HttpMethod`,
  `isBindMark`, `isHttpBinding`, `METHODS_WITHOUT_BODY`, `PathParams`, `query`,
  `readPathParams`, `RedirectStatus`, `SseConfig`.
- **Тело отказа HTTP** ([design](../../docs/design/errors.md)) — `ErrorDetailsLike`,
  `failCodeOf`, `PROBLEM_MEDIA_TYPE`, `PROBLEM_TYPE_PREFIX`, `problemOf`,
  `problemTitleOf`, `problemTypeOf`, `ProblemDocument`. Документ RFC 9457, которым
  HTTP-граница отвечает на отказ; объявлен здесь, чтобы клиент читал его, не завися
  от серверного пакета.
- **Схемы** ([design](../../docs/design/schemas.md)) — `assertConverters`,
  `jsonSchema`, `jsonSchemaOf`, `leafJsonSchema`, `LeafJsonSchema`, `pickConverter`,
  `SchemaDocConverter`, `SchemaDocOptions`, `schemaVendorOf`.
- **Потоки** ([design](../../docs/design/streaming.md)) — `batch`, `collect`,
  `filter`, `gapTimeout`, `limit`, `tap`, `throttle`, `Topic`, `untilAborted`.
- **Ответ транспорта** — `isTransportResponse`, `TRANSPORT_RESPONSE`,
  `TransportResponse`.
- **Реэкспорт [`@nestlingjs/common.misc`](../common.misc/)** — типы Standard Schema,
  чтобы клиенту и генератору документации не ставить пакет спецификации.

## Границы пакета

Пакет описывает операции и не выполняет их. Реализация, контейнер, пайплайн
и транспорты живут в `@nestlingjs/app` и пакетах транспортов.
