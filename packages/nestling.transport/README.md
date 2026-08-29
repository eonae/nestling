# @nestling/transport

Абстракция транспорта: интерфейс `ITransport` (`capabilities`,
`serve(dispatch, signal)`, `close?()`) и значение `Dispatch`, через
которое [`@nestling/app`](../nestling.app) передаёт транспорту маршруты и
исполнение. На этом пакете построены
[`@nestling/transport.http`](../nestling.transport.http),
[`@nestling/transport.cli`](../nestling.transport.cli) и
[`@nestling/transport.nats`](../nestling.transport.nats).

> 🚧 Активная разработка, API меняется. Целевой дизайн:
> [`docs/design/transports.md`](../../docs/design/transports.md).

## Установка

```bash
npm install @nestling/transport
```

Пакет нужен авторам транспортов. Приложению достаточно конкретного
транспорта: `@nestling/transport.http`, `@nestling/transport.cli`.

## Минимальный пример

```ts
import { makeDispatch } from '@nestling/transport';

const dispatch = makeDispatch([Ping]);          // фаза WIRE
await transport.serve(dispatch, controller.signal);   // фаза START
```

## `ITransport`

```ts
interface ITransport {
  readonly capabilities: TransportCapabilities;
  serve(dispatch: Dispatch, signal: AbortSignal): Promise<void>;
  close?(): Promise<void>;
}
```

Транспорт получает маршруты только через `serve`. Метода `listen()` без
аргументов и метода регистрации отдельных endpoint'ов в интерфейсе нет.
`signal` — общий канал остановки приложения: транспорт прекращает приём
запросов, когда сигнал сработал.

На транспорт ссылаются токеном: `TransportToken = TokenString<ITransport>`.
Короткое имя, которое читает слой пайплайна (`meta.transport === 'http'`),
выводится из идентификатора токена функцией `transportNameOf`.

## `Dispatch`

```ts
interface Dispatch {
  /** Проекции маршрутов: паттерн, формы io, bind-карта, задекларированные ошибки */
  readonly routes: readonly RouteDeclaration[];

  /** Исполняет endpoint: выбирает ветку «с пайплайном» или «без» */
  call(pattern, ctx, options?): Promise<ResponseContext>;
}
```

`Dispatch` делит декларацию на две части. Транспорт получает `routes` —
всё, что нужно для роутинга и разбора запроса. Исполнение остаётся за
`call`. `RouteDeclaration` — декларация без `handle`, `pipeline`, `deps`,
`resolve` и `$needs`, поэтому транспорт не может выполнить endpoint в обход
`call`.

`call(pattern, ctx, options?)` бросает ошибку, если `pattern` не
принадлежит этому `dispatch`. Опции границы (`DispatchOptions`) передаются
аргументом `call`, а не хранятся в таблице маршрутов: они описывают
конкретный транспорт, а не набор маршрутов.

| Опция | Что делает |
|---|---|
| `exposeErrorDetails` | раскрывать ли клиенту детали ошибок, не являющихся `Fail` |
| `onUnknownFail` | хук диагностики: вызывается, когда ответ с незадекларированным кодом заменяется на `UnknownError` |

`makeDispatch(endpoints)` принимает только исполнимые декларации
(`ExecutableDeclaration`, то есть `EndpointDefinition<I, O, P, never>`).
Декларация с `deps`, класс-хендлером или классами-юнитами в пайплайне
сначала получает зависимости через `endpoint.resolve(resolver)`;
`assemble` делает это на фазе WIRE. Транспорту знать о DI-контейнере не
нужно. Две декларации одного транспорта с одним паттерном — ошибка
`makeDispatch`.

Обе ветки `call` открывают область контекста запроса
([`@nestling/pipeline`](../nestling.pipeline)). Для декларации с
пайплайном это делает рантайм пайплайна, для декларации без пайплайна —
сам `dispatch`, с пустой проекцией и сигналом запроса. Поэтому сервис в
глубине графа ведёт себя одинаково на обоих путях: `peek()` возвращает
`undefined` вместо ошибки «нет контекста запроса», а `Ctx(Signal)` отдаёт
сигнал этого запроса.

## `capabilities`

```ts
interface TransportCapabilities {
  readonly input: ReadonlySet<FormKind>;   // 'value' | 'stream' | 'events' | 'multipart'
  readonly output: ReadonlySet<FormKind>;
}
```

Поле обязательно: какие формы io транспорт умеет передавать — это данные,
а не договорённость. Тип объявлен в `@nestling/pipeline` (набор форм —
понятие ядра) и реэкспортирован здесь, чтобы автору транспорта хватало
одного импорта.

Декларация, форма которой не входит в способности транспорта, отклоняется
до обслуживания первого запроса. Проверку выполняет `App` на фазе ASSEMBLE
(там известны и декларации, и инстансы транспортов) и сам транспорт внутри
`serve`, до открытия сокета. Обе проверки вызывают одну функцию ядра, поэтому
сообщение одно:

```
Endpoint 'watch' declared in module 'module:ops': transport 'cli' does not
support form 'events' in 'output' (supported: value, stream).
```

Таблица способностей транспортов V1 —
в [`docs/design/transports.md`](../../docs/design/transports.md).

## Справочник API

| Экспорт | Что это |
|---|---|
| `ITransport` | интерфейс транспорта |
| `TransportToken` | тип токена транспорта |
| `TransportCapabilities` | способности транспорта по формам io (реэкспорт из `@nestling/pipeline`) |
| `transportNameOf(token)` | короткое имя транспорта по токену (реэкспорт из `@nestling/pipeline`) |
| `Dispatch` | таблица маршрутов и исполнение |
| `RouteDeclaration` | проекция декларации без исполнения |
| `DispatchOptions` | опции границы для `call` |
| `ExecutableDeclaration` | декларация, у которой все зависимости уже получены |
| `makeDispatch(endpoints)` | строит `Dispatch` из исполнимых деклараций |
| `toRouteDeclaration(definition)` | проекция одной декларации |

## Границы пакета

Пакет не содержит ни одного реального транспорта: HTTP, CLI и NATS живут в
`@nestling/transport.*`.
