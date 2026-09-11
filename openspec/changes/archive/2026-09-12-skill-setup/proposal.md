## Why

Первый внешний прогон скилла
([d/14](../../../docs/history/discussions/14-first-external-run.md)): агент
вне репозитория написал по `@nestlingjs/agent-skill` 0.1.3 сервис коротких
ссылок — две фичи, шесть endpoint'ов, восемь тестов. Три находки относятся
к самому скиллу.

Сниппеты противоречат друг другу как приложение. `app.ts` объявляет политику
`everyEndpoint(…).hasLayer(observability)`, а `GetUser` в `endpoints.md` идёт
без `pipeline:`. Скопированные вместе, они останавливают ASSEMBLE. Каждый
сниппет компилируется против настоящих пакетов, но по одному: спека сверяет
текст блоков с файлами и приложение из них не собирает.

Скилл говорит, как написать код, и молчит о том, как его запустить. В нём нет
ни tsconfig, ни скриптов, ни условия `testing` вне jest, ни строки о том, что
type stripping в Node не исполняет декораторы. Всё это агент выяснял опытом.

HTTP-форма ответа названа одной строкой. Поле `redirect:` обязательно для
редиректа, иначе ответ становится `internal_error`; в скилле поля нет. Не
названы и шесть пакетов: `outbox`, `subscriptions`, `models`, `transport.cli`,
`client`, `eslint-plugin`.

Решение зафиксировано записью
[ideas.md [2026-09-12] «Скилл после первого внешнего прогона»](../../../docs/decisions/ideas.md);
change 66 в [roadmap.md](../../../docs/decisions/roadmap.md).

## What Changes

- **Спека собирает приложение из сниппетов.** `snippets.spec.ts` вызывает
  `assembleTest` для `app` из `snippets/app.ts`. Политика, незаявленный слой,
  ребро между фичами и провайдер юнита слоя — всё, что ловит ASSEMBLE, начинает
  ловить `yarn verify`. Сниппеты вне приложения (`call-neighbour.ts`,
  `handler-unit.ts`, `minimal-app.ts`) остаются только компилируемыми.
- **`GetUser` и `ListUsers` получают слой `observability`** — первое следствие
  сборки. Демонстрация `makePipeline().pre(withRequestId())` остаётся в
  `pipeline.md`, где этим слоем собран сам `observability`.
- **Новый `references/setup.md`**: `tsconfig.json` для `tsc` без бандлера,
  скрипты `package.json` (`build`, `dev` через `tsx`, `test` через
  `node --test --conditions=testing` либо jest), установка и конфиг
  `@nestlingjs/eslint-plugin`, одна фраза про декораторы и type stripping.
- **Новый `references/http.md`**: форма ответа HTTP — `redirect:` в декларации
  и `HttpResponse.redirect(url)`, `HttpResponse.of(value, { headers, cookies })`,
  `Ok.created`, `Ok.accepted`, `Ok.noContent`, поле `status:`. `endpoints.md`
  отдаёт этому файлу свой абзац об `HttpResponse`: он стоит на 194 строках при
  потолке 200.
- **Правило 6 в `SKILL.md`**: корень с `hasLayer` обязывает каждый endpoint,
  включая форму с операцией и `implement`, объявить `pipeline:` или
  `detached: '<reason>'`. Правило о `redirect:` встаёт в тот же список.
- **«Where to look next» получает таблицу пакетов** — по строке на `outbox`,
  `subscriptions`, `models`, `transport.cli`, `client` и `eslint-plugin` с одним
  предложением «когда нужен».
- **`testing.md` получает второй блок с `node:test`** и `node:assert/strict` под
  флагом `--conditions=testing`; jest остаётся первым.

## Capabilities

### New Capabilities

Нет: новых способностей change не вводит.

### Modified Capabilities

- `agent-skill-content`: перечень `references/` растёт с восьми файлов до
  десяти (`setup.md`, `http.md`); список правил, которые скилл обязан назвать,
  получает слой при политике и `redirect:`; появляется требование о том, что
  скилл называет каждый публикуемый пакет фреймворка.
- `agent-skill-snippet-check`: сниппеты приложения проверяются не только
  компиляцией, но и сборкой — `assembleTest` для `app`; требование называет,
  какие сниппеты в приложение не входят и почему.

## Non-goals

- **`references/diagnostics.md`.** Тексты ошибок меняют change'и 67 и 68;
  справочник пишется в change'е 68, когда они устоятся
  ([d/14](../../../docs/history/discussions/14-first-external-run.md), пункт A4).
- **Шаблон проекта** (`--template`, `create-nestling-app`). Требует решения о
  сборщике; отложен
  ([deferred [2026-09-12] «Шаблон проекта»](../../../docs/decisions/deferred.md)).
- **Отдельная команда `nestling dev`.** `tsx` исполняет декораторы и watch даёт
  сам; нужна строка в `setup.md`, а не команда.
- **Изменения публичного API пакетов.** Change правит текст скилла, его
  сниппеты и проверки. Правки самого фреймворка идут change'ами 67–70.
- **`references/outbox.md` и `references/client.md`.** Пока строка в таблице
  пакетов; решать по второму внешнему прогону.

## Impact

- `packages/nestling.agent-skill/skill/` — новые `references/setup.md` и
  `references/http.md`, правки `SKILL.md`, `endpoints.md`, `testing.md`.
- `packages/nestling.agent-skill/snippets/` — `get-user.endpoint.ts` и
  `list-users.endpoint.ts` получают слой; новые сниппеты под `http.md` и под
  блок `node:test` в `testing.md`.
- `packages/nestling.agent-skill/src/snippets.spec.ts` — сборка `app` через
  `assembleTest`; `src/skill.spec.ts` — перечень `references/` из десяти файлов.
- `packages/nestling.agent-skill/README.md` — число файлов скилла в разделе
  «Установка».
- `openspec/specs/agent-skill-content/spec.md` и
  `openspec/specs/agent-skill-snippet-check/spec.md` — дельты.
- `docs/decisions/ideas.md` — пометка «РЕАЛИЗОВАНО» на записи [2026-09-12];
  `docs/decisions/roadmap.md` — статус change'а 66.
