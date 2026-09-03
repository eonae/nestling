<!-- Первый экран: единственный кусок сырой вёрстки. Внутри не должно быть
     пустых строк — они разорвут HTML-блок markdown. Текст правится по месту. -->
<section class="hero">
<h1>Nestling</h1>
<p class="lead">TypeScript-фреймворк для бэкенда: меньше, современнее и архитектурно проще, чем NestJS. Без рантайм-магии — <strong>гарантии вместо конвенций</strong>.</p>
<div class="hero-cta">
<a class="btn primary" href="#first-steps">Первые шаги →</a>
<a class="btn ghost" href="#vs-nest">Чем отличается от NestJS</a>
</div>
<p style="color:var(--text-dim);font-size:14px;margin-top:8px">
<span class="pill target">preview</span>&nbsp; Это превью целевой модели: API показан так, будто уже реализован полностью.
</p>
</section>

::::cards
:::card 🧩 Модули — это значения
Обычные объекты, а не классы с декораторами. Видимость задают ES-экспорты, а не рантайм-инкапсуляция.
:::
:::card 📐 Schema-first endpoints
Вход и выход endpoint'а объявлены схемой: Zod, Valibot или любой другой валидатор Standard Schema. Валидация, типы и документация выводятся из одного источника.
:::
:::card 🌊 Пайплайн вместо middleware
Плоские фазы `pre / ok / catch / finally`. Без `next()`, вложенных обёрток и скрытого потока управления.
:::
:::card ⚡ Жадный контейнер
Весь граф строится на старте. Циклы, недостающие зависимости и невалидный конфиг — ошибка запуска, а не инцидент в три часа ночи.
:::
::::

## Что такое Nestling {#what}

Nestling — backend-фреймворк на TypeScript для тех, кто привык к структуре NestJS, но не хочет платить за неё сложностью. Он берёт из Nest то, чем команды действительно пользуются, убирает лишнее и добавляет современные возможности языка и платформы.

Главная идея — **no runtime magic**. Всё, что Nest делает через скрытую рефлексию и отложенную сборку, Nestling делает явно и на этапе сборки графа. Явный граф даёт то, чего у Nest нет: полную визуализацию, топологический порядок инициализации и остановки, проверку циклов и падение на старте вместо падения в проде.

:::note Почему «nestling»
Nestling — птенец: младший, лёгкий родственник большого Nest. Пакеты публикуются под скоупом `@nestling/*`. DI-ядро (`@nestling/container`) не имеет сторонних зависимостей и работает даже в браузере.
:::

## Семь принципов {#philosophy}

Все решения в Nestling выводятся из небольшого набора принципов. Решение, которое им противоречит, отвергается, каким бы удобным оно ни казалось.

| Принцип | Что это значит на практике |
| --- | --- |
| **No runtime magic** | Зависимости объявляются явным массивом токенов. Скрытой рефлексии типов и отложенной сборки нет: граф известен на `build()`. |
| **Guarantee over convention** | Если что-то нельзя нарушать, это должно быть невозможно структурно, а не по договорённости. Пример: ранний `listen()` в `@OnInit` невозможен, потому что `dispatch` в этот момент ещё не существует. |
| **Explicit over implicit** | Порядок запуска ресурсов, состав пайплайна, границы модулей видны в коде. Ничто не подключается глобально за спиной автора. |
| **Модули — значения** | Модуль равен обычному объекту. Поэтому параметризованный модуль — это просто функция; `DynamicModule`, `forRoot` и `forRootAsync` не нужны. |
| **Жадный контейнер** | Все провайдеры создаются на старте. Если фича не выбрана, её код не строится — это следствие, а не отдельный механизм. |
| **Schema-first endpoints** | Endpoint объявляет вход и выход схемой любого валидатора Standard Schema. Схема — единый источник для валидации, типов TypeScript и OpenAPI/AsyncAPI. |
| **Пайплайн работает со значениями** | Пайплайн знает только абстрактную модель данных. Байты, сжатие, CORS и разбор multipart принадлежат транспорту, а не пайплайну. |

## Что убрали из NestJS {#vs-nest}

Nestling ещё более opinionated, чем Nest. Проще всего понять его через список того, чего в нём осознанно нет, и того, что стоит на этом месте.

| В NestJS есть | В Nestling | Что вместо |
| --- | --- | --- |
| `forwardRef` и циклические зависимости | нет {.no} | Цикл — ошибка сборки на `build()`. |
| `REQUEST` / `TRANSIENT` scope | нет {.no} | Состояние запроса живёт в типизированном контексте пайплайна, а не в контейнере. Глубокие сервисы читают его через [инжектируемые ридеры](fundamentals.html#context) `Ctx(RequestId)`. |
| Модули-классы, `@Module`, хуки модуля | нет {.no} | Модуль — обычный объект. Вопроса «что раньше: `OnModuleInit` модуля или сервиса» не возникает. |
| `DynamicModule` / `forRoot` | нет {.no} | Модуль — значение, поэтому `LoggingModule({ level: 'debug' })` — обычная функция. |
| Middleware | нет {.no} | Слово подразумевает обёртки и `next()`, которых здесь нет. Вместо него фазы `.pre` / `.ok` / `.catch` / `.finally`. |
| Interceptors на RxJS | нет {.no} | Фазы пайплайна. RxJS не входит в ядро; внутри хендлера он доступен как обычная зависимость. |
| Exception filters как подсистема | нет {.no} | Централизованное преобразование ошибок — обычный `.catch`-юнит. |
| Guards и Pipes как отдельные сущности | нет {.no} | Это `.pre`-юниты, которые дополняют типизированный контекст. |
| Экспериментальные декораторы TS и `reflect-metadata` | нет {.no} | Стандартные декораторы ECMAScript. Ноль зависимостей в ядре контейнера. |

:::note good Что осталось
Три знакомых вида провайдеров (value, class, factory), `@Injectable`, инъекционные токены, хуки `@OnInit`/`@OnDestroy` в строгом топологическом порядке, модульная система — проще, чем в Nest, и необязательная. Контейнер можно использовать отдельно: во фронтенде, в CLI, рядом с Fastify.
:::

## Первые шаги {#first-steps}

У Nestling два уровня входа. Начните с минимального — **без DI, классов и декораторов**. Транспорт создаётся напрямую, endpoint — обычное значение, которое возвращает конструктор транспорта (`httpEndpoint`).

```ts endpoints.ts
import { makePipeline, validate } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

const CreateUser = z.object({
  name: z.string().min(1).max(100),
  email: z.email(),
});
type CreateUser = z.infer<typeof CreateUser>;

export const createUser = httpEndpoint({
  method: 'POST',
  path: '/users',                    // литерал: path-параметры видны типам
  input: CreateUser,                 // схема входа
  output: z.object({ id: z.string(), name: z.string() }),
  pipeline: makePipeline().pre(withTiming),
  handle: async (input: CreateUser) => {
    // input уже проверен схемой и типизирован
    return { id: crypto.randomUUID(), name: input.name };
  },
});
```

Чтобы обслуживать такой endpoint по HTTP, соберите таблицу маршрутов и передайте её транспорту:

```ts main.ts
import { makeDispatch } from '@nestling/transport';
import { HttpTransport } from '@nestling/transport.http';
import { createUser } from './endpoints';

const server = new HttpTransport({ port: 3000 });
const shutdown = new AbortController();

await server.serve(makeDispatch([createUser]), shutdown.signal);
```

Схема `input` даёт хендлеру типизированный `input`: не `any` и не ручное приведение типа. Вход по ней проверяет рантайм перед хендлером. Вернуть можно просто значение (оно оборачивается в `Ok`) или явно `Ok.created(...)`. Отказ объявляется через `defineFail` и перечисляется в `errors:`. Та же операция для CLI объявляется как `cliEndpoint({ command: 'create-user', ... })`: меняются только транспортные поля, а схемы, пайплайн и хендлер остаются теми же.

## Два уровня фреймворка {#two-levels}

Минимальный уровень выше — это ещё библиотека, а не фреймворк. Когда нужны DI, модули, хуки жизненного цикла и корректная остановка, вы переходите на полный уровень: `assemble` и модули. **Декларация при этом не меняется**: к ней добавляется `deps` (или класс-хендлер), а зависимости из контейнера получает `App`.

```ts create-user.endpoint.ts
import { httpEndpoint } from '@nestling/transport.http';
import { Ok, type Output } from '@nestling/pipeline';
import { basePipeline } from '../common/pipelines';
import { EmailTaken } from './user.errors';
import { UserService } from './user.service';

export const CreateUser = httpEndpoint({
  method: 'POST',
  path: '/api/users',
  input: CreateUser,
  output: UserView,
  errors: [EmailTaken],                      // отказы, которые может вернуть endpoint
  pipeline: basePipeline,
  deps: [UserService],                       // явный массив токенов
  handle: (users) => async (input: CreateUser): Output<UserView, EmailTaken> => {
    // внешняя функция вызывается один раз на сборке; замыкание — экземпляр
    if (await users.findByEmail(input.email)) {
      return EmailTaken({ email: input.email });   // 409 с кодом EMAIL_TAKEN
    }
    const user = await users.create(input);
    return Ok.created(user, { Location: `/api/users/${user.id}` });
  },
});
```

Разделение на два уровня видно в системе типов. Транспорт в standalone-режиме принимает только декларации без неразрешённых зависимостей. Декларация с `deps`, классом-хендлером или классами-юнитами в пайплайне требует `App`, который получает их из контейнера на старте. Компилятор не даст смешать два уровня незаметно.

:::note Куда дальше
[Основные концепции](concepts.html#endpoints) — endpoints, DI, модули, `Ok`/`Fail` и пайплайн подробно. [Основы](fundamentals.html#lifecycle) — контейнер, жизненный цикл, конфигурация, стриминг, схемы и OpenAPI, тестирование. [Масштабирование](scaling.html#monolith) — модульный монолит, порты и разнесение по процессам без переписывания кода.
:::
