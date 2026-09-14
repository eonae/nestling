## 1. Правило в спеке

- [x] 1.1 Дельта `packages-layout`: требование о виде объявления и требование о проверке манифестов сверены с текстом главной спеки
- [x] 1.2 Дельта `otel-package`: требование «Границы пакета названы зависимостями» переписано под раскладку peer и `dependencies`
- [x] 1.3 Дельта `docs-package-readme`: требование о разделе установки

## 2. Манифесты: zod

- [x] 2.1 `@nestlingjs/app`: `zod` в `peerDependencies` и `devDependencies`
- [x] 2.2 `@nestlingjs/config.vault`, `@nestlingjs/inbox`, `@nestlingjs/outbox`: то же
- [x] 2.3 `@nestlingjs/mcp`, `@nestlingjs/subscriptions`: то же
- [x] 2.4 `@nestlingjs/transport.http`, `@nestlingjs/transport.nats`: то же
- [x] 2.5 `@nestlingjs/drizzle.pg`: то же, рядом с уже объявленными `drizzle-orm` и `pg`
- [x] 2.6 `yarn install` проходит без предупреждений о недостающих peer; пример, который не объявил используемое, объявляет

## 3. Манифест сателлита телеметрии

- [x] 3.1 `@nestlingjs/otel`: `@opentelemetry/api`, `sdk-trace-base` и `sdk-metrics` в `peerDependencies` и `devDependencies`
- [x] 3.2 `@opentelemetry/resources` и `semantic-conventions` остаются в `dependencies`
- [x] 3.3 Счётные проверки `boundary.spec.ts` сателлита пересчитаны под новую раскладку

## 4. Проверка раскладки

- [x] 4.1 `scripts/boundary/manifest-deps.mjs`: список исключений константой, у каждого имени причина
- [x] 4.2 Скрипт читает `publishablePackages()`, отбрасывает скоуп `@nestlingjs`, сверяет остаток со списком
- [x] 4.3 Сообщение называет пакет, зависимость и куда имя переносится
- [x] 4.4 Вызов в `yarn verify` и `yarn verify:fresh` рядом с `public-api-validator.mjs`
- [x] 4.5 Прогон на чистом дереве без `dist` проходит
- [x] 4.6 Спека скрипта: лишнее имя ловится, имя из списка молчит, приватный пакет пропускается

## 5. Тексты

- [x] 5.1 README затронутых пакетов: раздел установки называет, что ставится рядом, обе языковые половины
- [x] 5.2 Глава установки гайда и её английская пара
- [x] 5.3 `docs/design/` там, где названа раскладка зависимостей пакета
- [x] 5.4 Плашки статуса README затронутых пакетов обновлены

## 6. Definition of Done

- [x] 6.1 `yarn verify` зелёный
- [x] 6.2 README затронутых пакетов обновлены, включая плашки статуса
- [x] 6.3 `design/` и `decisions/` синхронизированы по правилам CLAUDE.md
- [x] 6.4 Запись [ideas.md [2026-09-14]](../../../docs/decisions/ideas.md) «Зависимости пакетов: свой пакет в `dependencies`, библиотека в `peerDependencies`» несёт пометку «РЕАЛИЗОВАНО»
- [x] 6.5 `yarn docs:audit` — 0 ERROR
- [x] 6.6 Затронутые `examples/*` мигрированы, главы гайда пересверены с обновлённой датой в плашке «сверено с кодом»
- [x] 6.7 Скилл `packages/nestling.agent-skill/skill/` обновлён, если change изменил публичные имена, формы вызова или состав пакетов
- [x] 6.8 `main` не тронут — слияние делает Merger после `/opsx:archive`
