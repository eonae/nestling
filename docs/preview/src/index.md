<!-- Первый экран: единственный кусок сырой вёрстки. Внутри не должно быть
     пустых строк — они разорвут HTML-блок markdown. Текст правится по месту. -->
<section class="hero">
<h1>Nestling</h1>
<p class="lead">TypeScript-фреймворк для бэкенда: меньше, современнее и архитектурно честнее, чем NestJS. Без рантайм-магии — <strong>гарантии вместо конвенций</strong>.</p>
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
Не классы с декораторами, а plain-объекты. Видимость — через ES-экспорты, а не рантайм-инкапсуляцию.
:::
:::card 📐 Schema-first endpoints
Контракт (вход/выход) объявлен схемой — Zod, Valibot или любой Standard Schema-валидатор. Валидация, типы и документация — из одного источника.
:::
:::card 🌊 Pipeline вместо middleware
Плоские фазы `pre / ok / catch / finally`. Никаких `next()`, «луковицы» и скрытого control flow.
:::
:::card ⚡ Жадный контейнер
Весь граф строится на старте. Циклы, недостающие зависимости и битый конфиг — ошибка запуска, а не 3 часа ночи.
:::
::::

## Что такое Nestling {#what}

Nestling — это backend-фреймворк на TypeScript для тех, кто привык к структуре и принципам NestJS, но устал за неё платить. Мы берём из Nest то, что команды реально используют, выбрасываем лишнее и добавляем много современных удобств.

Одна из главных идей — **no runtime magic**. Всё, что Nest делает через скрытую рефлексию и отложенную сборку, мы делаем явно и на этапе сборки графа. Не потому что магия плоха и сама по себе, а потому что явный граф даёт то, чего у Nest нет: полная визуализация, топологический порядок init/destroy, проверка циклов и **fail-fast на старте** вместо падения в проде.

:::note Почему «nestling»
Nestling — птенец: младший, лёгкий родственник большого Nest. Пакеты публикуются под скоупом `@nestling/*`, а DI-ядро (`@nestling/container`) не тянет ни одной сторонней зависимости и работает даже в браузере.
:::

## Семь принципов {#philosophy}

Всё в дизайне Nestling выводится из небольшого набора опорных принципов. Если решение им противоречит — оно отвергается, как бы удобно ни выглядело.

| Принцип | Что означает на практике |
| --- | --- |
| **No runtime magic** | Зависимости объявляются явным массивом токенов. Никакой скрытой рефлексии типов, никакой отложенной сборки - граф известен на `build()`. |
| **Guarantee over convention** | Если что-то нельзя нарушить — это должно быть структурно невозможно, а не «мы договорились так не делать». Пример: ранний `listen()` в `@OnInit` невозможен, потому что `dispatch` физически ещё не существует. |
| **Explicit over implicit** | Порядок раскрутки ресурсов, состав пайплайна, границы модулей — всё видно в коде. Ничего не «навешивается» глобально за твоей спиной. |
| **Модули — plain values** | Модуль = обычный объект. Значит, «параметризованный модуль» — просто функция; концепции `DynamicModule` / `forRoot` / `forRootAsync` не нужны вообще. |
| **Жадный контейнер** | Все провайдеры инстанцируются на старте. «Не выбрал фичу → её код не построился» получается само собой. |
| **Schema-first endpoints** | Endpoint объявляет вход и выход схемой (любой Standard Schema-валидатор). Схема — единый источник для валидации, типов TS и OpenAPI/AsyncAPI. |
| **Pipeline оперирует значениями** | Pipeline знает только про абстрактную модель данных. Байты, сжатие, CORS, парсинг multipart — концерн транспорта, а не пайплайна. |

## Что мы убрали из NestJS {#vs-nest}

Nestling позиционируется как «ещё более opinionated, чем Nest». Проще всего понять его через *вычитание*: список того, чего в нём осознанно нет, и что стоит на этом месте.

| В NestJS есть | В Nestling | Что вместо |
| --- | --- | --- |
| `forwardRef` / циклические зависимости | нет {.no} | Циклов не должно существовать в принципе — они ловятся на `build()`. |
| `REQUEST` / `TRANSIENT` scope | нет {.no} | Request-состояние живёт в типизированном контексте пайплайна, а не в контейнере. Для глубоких сервисов — [read-only ALS-проекция](fundamentals.html#context) с инжектируемыми ридерами `Ctx(RequestId)`. |
| Модули-классы, `@Module`, хуки модуля | нет {.no} | Модуль — plain object. Никакой путаницы «что раньше — `OnModuleInit` модуля или сервиса». |
| `DynamicModule` / `forRoot` | нет {.no} | Модуль — значение ⇒ `LoggingModule({ level: 'debug' })` это просто функция. |
| Middleware | нет {.no} | Слово выброшено: оно врёт (подразумевает wrapping и `next()`). Честный словарь — `.pre` / `.ok` / `.catch` / `.finally`. |
| Interceptors (на RxJS) | нет {.no} | Фазы пайплайна. RxJS не в ядре — он доступен внутри хендлера как обычная зависимость. |
| Exception filters (подсистема) | нет {.no} | Централизованный маппинг ошибок — это обычный `.catch`-юнит. Отдельной подсистемы нет. |
| Guards, Pipes как отдельные сущности | нет {.no} | Всё это — `.pre`-юниты, монотонно наполняющие типизированный контекст. |
| Экспериментальные декораторы TS + `reflect-metadata` | нет {.no} | Стандартные декораторы ECMAScript. Ноль зависимостей в ядре контейнера. |

:::note good Что осталось
Три знакомых типа провайдеров (value / class / factory), `@Injectable`, инъекционные токены, lifecycle-хуки `@OnInit`/`@OnDestroy` (в строгом топологическом порядке), модульная система — но проще и опциональная. Контейнер можно использовать standalone: во фронтенде, в CLI, рядом с Fastify.
:::

## Первые шаги {#first-steps}

У Nestling два уровня входа. Начнём с минимального — **без DI, классов и декораторов**. Транспорт создаётся напрямую, endpoint — обычное значение через конструктор своего транспорта (`httpEndpoint`).

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
  pipeline: makePipeline().pre(validate()),
  handle: async (input: CreateUser) => {
    // input уже провалидирован и типизирован
    return { id: crypto.randomUUID(), name: input.name };
  },
});
```

Запуск такого endpoint'а на HTTP-транспорте — три строки:

```ts main.ts
import { HttpTransport } from '@nestling/transport.http';
import { createUser } from './endpoints';

const server = new HttpTransport({ port: 3000 });
server.route(createUser);
await server.listen();
```

Обрати внимание: схема `input` плюс `.pre(validate())` дают **типизированный**`input` в хендлере — не `any`, не ручной каст. Вернуть можно просто значение (обернётся в `Ok`) или явно `Ok.created(...)`; отказ объявляется `defineFail` и перечисляется в `errors:`. Та же операция на CLI объявляется `cliEndpoint({ command: 'create-user', ... })` — меняется только транспортный словарь, схемы, пайплайн и хендлер остаются теми же.

## Два уровня фреймворка {#two-levels}

Минимальный уровень выше — это ещё «не фреймворк, а библиотека». Когда появляется потребность в DI, модулях, lifecycle-хуках и graceful shutdown, ты переходишь на полный уровень: `App` + модули. **Декларация при этом не меняется вообще** — к ней добавляется `deps` (или класс-хендлер), а гашение зависимостей берёт на себя App.

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
  errors: [EmailTaken],                      // множество отказов ручки
  pipeline: basePipeline,
  deps: [UserService],                       // явный массив токенов
  handle: (users) => async (input: CreateUser): Output<UserView, EmailTaken> => {
    // внешний вызов — один раз на сборке, замыкание = инстанс
    if (await users.findByEmail(input.email)) {
      return EmailTaken({ email: input.email });   // 409 с кодом EMAIL_TAKEN
    }
    const user = await users.create(input);
    return Ok.created(user, { Location: `/api/users/${user.id}` });
  },
});
```

Двухуровневость — не случайность, а часть дизайна: она **видна в системе типов**. Standalone-транспорты принимают только «чистые» декларации без неразрешённых зависимостей; декларация с `deps`, класс-хендлером или классами-юнитами в пайплайне требует `App`, который гасит их из контейнера на старте. Компилятор не даст смешать миры молча.

:::note Куда дальше
[Основные концепции](concepts.html#endpoints) — endpoints, DI, модули, `Ok`/`Fail` и pipeline подробно. [Основы](fundamentals.html#lifecycle) — контейнер, жизненный цикл, конфигурация, стриминг, схемы и OpenAPI, тестирование. [Масштабирование](scaling.html#monolith) — модульный монолит, порты и разнесение по процессам без переписывания кода.
:::
