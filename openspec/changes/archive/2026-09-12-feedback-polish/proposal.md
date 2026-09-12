## Why

Первый внешний прогон — агент вне репозитория написал сервис коротких
ссылок на 0.1.3 — нашёл шесть мест, о которые пользователь споткнулся за
час ([d/14](../../../docs/history/discussions/14-first-external-run.md),
пункты B2, B4, B6, B7, B9, B10). Каждое чинится в несколько строк, и
решение по ним записано в
[ideas.md [2026-09-12]](../../../docs/decisions/ideas.md) «Runtime-строки
на английском и четыре починки по первому внешнему прогону».

Общего у них одно: всё это видит пользователь, который читал только
README и скилл. Русская строка попадает в его OpenAPI-документ, ошибка
`@Component` говорит про хендлер у класса без `handle`, JSDoc зовёт
несуществующий `Ok.of`, редирект уходит с `transfer-encoding: chunked`, а
`npm audit` показывает три high по `find-my-way` 8.x.

## What Changes

- **Runtime-строки пакетов — английские.** Всё, что процесс печатает или
  отдаёт наружу, пишется по-английски: сообщения ошибок, логи, причины
  `hidden` и `detached`, `summary` и `description` встроенных операций.
  Русскими остаются README, JSDoc, комментарии и документация.
- **Правило линтера вместо дисциплины.** Общий конфиг ESLint запрещает
  кириллицу в строковых литералах и шаблонных строках файлов `src/`
  правилом `no-restricted-syntax`. Спеки, фикстуры и примеры под правило
  не попадают.
- **Шесть мест переводятся:** причина `hidden` документа в
  `@nestlingjs/openapi`, причина `detached` проб в
  `@nestlingjs/transport.http`, `summary` и `description` встроенных
  операций в `@nestlingjs/outbox` и `@nestlingjs/subscriptions`, два
  сообщения ошибок валидации в `@nestlingjs/common.misc`. Описания
  операций попадают в OpenAPI-документ пользователя, сообщения валидации
  — в его лог.
- **`ValidComponentShape` получает страховку от `any`.** Когда класс не
  проходит ограничение параметра декоратора, TypeScript печатает само
  ограничение `new (...) => any`, и `any` в позиции экземпляра проходит
  под `HandlerShape`: в ошибке длины списка у класса без `handle`
  появляется текст про хендлер. Проверка экземпляра отсекает `any`, а
  новый каталог `type-tests` контейнера закрепляет текст снапшотом.
- **JSDoc без `Ok.of`.** Три JSDoc называют метод, которого нет: два в
  `helpers.ts` транспорта HTTP и один в пробах `@nestlingjs/app`. Форма
  записи одна — `new Ok(value)`.
- **Пустой ответ несёт `content-length: 0`.** Ветка `value === null` в
  `sendResponse` ставит заголовок для всех статусов, кроме 204 и 304, у
  которых тела нет по протоколу. Редирект перестаёт уходить с
  `transfer-encoding: chunked`.
- **`find-my-way` — `^9.7.0`.** Advisory GHSA-c96f-x56v-gq3h (DDoS по
  HTTP/2, high) закрыт в 9.7.0; транспорт держит `^8.2.0`, и у восьмёрки
  починки не будет.
- **Раздел «When Nestling is not the tool» в корневом README.** Три-четыре
  предложения о том, когда выигрыш не окупается.

## Capabilities

### New Capabilities

- `runtime-message-language`: язык строк, которые процесс печатает или
  отдаёт наружу; граница «runtime-строка против текста для читателя
  репозитория»; проверка правилом линтера и её область.

### Modified Capabilities

- `class-roles`: диагностика формы класса у `@Component` срабатывает
  только на классе, у которого метод `handle` действительно есть; текст
  закреплён снапшот-тестами в `type-tests` контейнера.
- `http-transport-boundary`: пустой ответ уходит с `content-length: 0`,
  кроме статусов 204 и 304.

## Non-goals

- **Перевод README пакетов, JSDoc и комментариев.** Другой читатель и
  другой вопрос; он остаётся открытым в записи
  [ideas.md [2026-09-10]](../../../docs/decisions/ideas.md) «Публикация в
  npm».
- **Добавление `Ok.of`.** Симметрия с `Ok.created` дала бы вторую запись
  того же значения; правится JSDoc, а не API.
- **Проверка `@nestlingjs/viz`.** У пакета свой конфиг ESLint, общей базы
  он не подключает, и решение о его публикации открыто.
- **Перевод текстов в `examples/`.** Примеры иллюстрируют русский гайд, и
  их `summary` цитируются главами.
- **Диагностика незаявленного отказа, правило `dependency-list` и
  параметр query в разобранной форме.** Это change'и 68, 70 и 69.

## Impact

- **Код:** `packages/nestling.container/src/providers/role.decorators.ts`,
  `packages/nestling.transport.http/src/adapter.ts`,
  `packages/nestling.transport.http/src/probes.ts`,
  `packages/nestling.transport.http/src/helpers.ts`,
  `packages/nestling.openapi/src/module.ts`,
  `packages/nestling.outbox/src/operations.ts`,
  `packages/nestling.subscriptions/src/operations.ts`,
  `packages/nestling.app/src/health/tokens.ts`,
  `packages/common.misc/src/validate.ts`.
- **Конфигурация:** `.config/eslint.config.js` (новое правило),
  `examples/*/eslint.config.js` (правило выключено), новый каталог
  `packages/nestling.container/type-tests` и его `tsconfig.json`.
- **Зависимости:** `find-my-way` в `@nestlingjs/transport.http`,
  `yarn.lock`.
- **Документация:** корневой `README.md`, глава гайда
  `docs/guide/26-extending.md` (цитирует `operations.ts` подписок),
  README затронутых пакетов.
- **Совместимости:** публичное API не меняется; меняются тексты, которые
  пользователь видит, и один заголовок ответа.
