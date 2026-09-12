# Что ушло из барелей

Список имён, которые перестали быть публичными. Каждое осталось экспортом
своего модуля: вернуть его в барель — одна строка, и правка не ломающая.

Читателя искали в четырёх местах: импорт или реэкспорт по имени пакета вне
`src`, упоминание в `docs/design/` и `docs/guide/`. README своего пакета
читателем не считается — он сверяется с барелем и оправдал бы любое имя.
Последнее слово за компилятором: `yarn verify` собирает все пакеты и примеры,
и имя, без которого не выводится тип у потребителя (TS2742), возвращается
строкой с пометкой ниже.

## `@nestlingjs/common.static-server`

| Имя | Решение |
| --- | --- |
| `StaticServer` | осталось — `@nestlingjs/viz` |
| `StaticServerOptions` | ушло |

## `@nestlingjs/common.graphs`

| Имя | Решение |
| --- | --- |
| `DAG`, `INode`, `VisitCallback`, `VisitOptions` | остались — `@nestlingjs/container` |
| `TraversalDirection` | ушло |

## `@nestlingjs/models`

Барель переписан поимённо, все три имени остались. Читателя нет ни у одного:
пакет не импортирует никто. Это говорит про пакет, а не про имена, поэтому
правило здесь молчит — вопрос вынесен в «Открытые вопросы» design-дока.

| Имя | Решение |
| --- | --- |
| `fromType`, `fromScratch`, `makeModel` | остались |

## `@nestlingjs/common.misc`

| Имя | Решение |
| --- | --- |
| двенадцать имён схем и типов | остались — `@nestlingjs/app`, `@nestlingjs/operations`, `docs/design/schemas.md` |
| `Nullable` | ушло |
| `Nullish` | ушло |

## `@nestlingjs/transport.nats`

Шов коннектора остался тремя именами, и они названы в
[transports.md §7.6](../../../docs/design/transports.md): `NatsConnector`,
`NatsConnectOptions`, `NatsLike`. Остальные типы шва — части `NatsLike`:
подставить свой клиент можно, не называя их.

| Имя | Решение |
| --- | --- |
| `NatsConnector`, `NatsConnectOptions`, `NatsLike` | остались — шов коннектора |
| `defaultConnector` | ушло |
| `NatsHeadersLike`, `NatsMsgLike`, `NatsJsMsgLike`, `NatsPubAckLike` | ушли |
| `NatsSubscriptionLike`, `NatsSubscriptionOptions` | ушли |
| `NatsJetStreamLike`, `NatsJetStreamManagerLike` | ушли |
| `NatsStreamConfigLike`, `NatsConsumerConfigLike` | ушли |
| `natsConfigKeys` | осталось — право привязать источник, названо в [config.md §3](../../../docs/design/config.md) парой к `httpServerKeys` |

## `@nestlingjs/transport.http`

Байтовые части остались публичными: этого требует спека
[`http-transport-boundary`](../../specs/http-transport-boundary/spec.md) —
на них собирается своя реализация `ITransport` поверх стороннего
HTTP-сервера, и это проверяет `satellite.integration.spec.ts`. Отсюда
уточнение к правилу: читателем имени считается и требование спеки, а не
только импорт, `docs/design/` и `docs/guide/`.

| Имя | Решение |
| --- | --- |
| `HTTP_CAPABILITIES`, `HTTP_TRANSPORT_NAME`, `HttpRouter` | остались — satellite |
| `parseJson`, `parseNdjson`, `parseRaw`, `parseMultipartForm`, `sendResponse` | остались — байтовые части |
| `assemblePayload`, `bindingNeedsBody`, `readQuery` | остались — satellite |
| `HttpOutputSync` | осталось — пара к `HttpOutput`, оба названы спекой `http-handler-form` |
| `readBody`, `parseJsonBuffer`, `collectFileParts` | ушли — спека называет четыре разбора по формам, не их внутренности |
| `BytesObserver`, `MultipartResult`, `SendOptions`, `RouteEntry` | ушли |
| `HttpTransportOptions`, `HttpServerOptions`, `HttpServerSpec`, `HttpRequestListener` | ушли |
| `HttpEndpointDictionary`, `HttpImplementDictionary`, `HttpHandlerClass`, `HttpHandlerFn`, `StartContext` | ушли |
| `HttpResponseMeta`, `HttpResponseOptions`, `RedirectOptions`, `DEFAULT_REDIRECT_STATUS` | ушли |
| `DEFAULT_SSE_HEARTBEAT`, `SSE_ERROR_EVENT` | ушли |
| `JsonParseError`, `MultipartFieldError`, `PayloadTooLargeError` | ушли — транспорт переводит их в коды ответа сам |
| `NotReady`, `HttpProbesOptions` | ушли |
| `BindingBearer`, `PayloadSources` | ушли |
| реэкспорт `@nestlingjs/operations` (`query`, `body`, `HttpBinding`, `isHttpBinding` и ещё 15) | ушёл — автор декларации берёт их из самого пакета; `@nestlingjs/openapi` переведён на прямой путь |

## `@nestlingjs/container`

Осталось 40 имён из 96: те, что импортируют пакеты и примеры, и те, что
названы в `docs/design/` и `docs/guide/`. Ушли предикаты и типы определений
провайдеров, метаданные ролей и хуков, внутренности переключателей и весь
граф целиком — у графа нет ни одного читателя даже среди примеров.

| Имя | Решение |
| --- | --- |
| `ClassToken`, `TokenOptions` | ушли |
| `ClassProviderDefinition`, `FactoryProviderDefinition`, `FactoryProviderWithDeps`, `FamilyProviderDefinition`, `ProviderDefinition`, `ResourceProviderWithDeps`, `ValueProviderDefinition`, `ResourceClass`, `SyncValue`, `UnwrapTokens`, `ProvidersFactory` | ушли |
| `FamilyAllToken`, `FamilyAutoToken`, `FamilyMemberToken` | ушли |
| `decoratorOf`, `readRoleMeta`, `ClassRole`, `RoleMetadata` | ушли |
| `familyOf`, `getAllSentinelFamily`, `isTokenFamily`, `resolveAutoDependency` | ушли |
| `isClassDefinition`, `isDefinition`, `isFactoryProvider`, `isFamilyDefinition`, `isResourceDefinition`, `isValueDefinition`, `isModule` | ушли |
| `getLifecycleHooks`, `resolveHook`, `Hook`, `LifecycleHooks`, `LifecycleMetadata` | ушли |
| `BRANCH`, `isSwitch`, `isSwitchBranch`, `switchOf`, `unknownValueMessage`, `BranchMeta`, `NoExtraValues`, `PickTable`, `Switch`, `SwitchBranch`, `SwitchOptions`, `TableItems`, `Toggle`, `ToggleSwitch`, `Unbranch` | ушли |
| `DIGraph`, `DINode`, `DINodeData`, `DINodeMetadata`, `JsonDIGraph`, `JsonDINode` | ушли |

Три имени названы спеками — `ProviderDefinition` (форма рецепта семейства),
`ProvidersFactory` (фабрика провайдеров модуля), `getLifecycleHooks`
(идемпотентность `@OnStart`). Каждое там описывает модель или поведение, а
не требует экспорта, поэтому они ушли вслед за остальными.

## `@nestlingjs/container/tokens`

Подпуть отдаёт пять имён: `Token`, `makeToken`, `tokenId`, `makeTokenFamily`
и `TokenFamily`. Перечень — подмножество корневого.

| Имя | Решение |
| --- | --- |
| `TokenFamily` | **вернулось по TS2742** — тип результата `makeTokenFamily`: без него `PortFamily` и `EmitterFamily` в `@nestlingjs/operations` не выводятся у потребителя |
| `Constructor`, `InjectionToken`, `UnwrapInjectionTokens`, `ClassToken`, `TokenOptions` | ушли из подпути; в корневом бареле остаются те, у кого есть читатель |
| `isToken`, `asFamilyMember`, `getAutoSentinelFamily`, `familyOf`, `getAllSentinelFamily`, `isTokenFamily`, `resolveAutoDependency` | ушли из подпути |
| `FamilyAllToken`, `FamilyAutoToken`, `FamilyMemberToken` | ушли из подпути |
