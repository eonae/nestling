## 1. Правило в спеке

- [ ] 1.1 Дельта `packages-layout`: требование о виде объявления и требование о проверке манифестов сверены с текстом главной спеки
- [ ] 1.2 Дельта `otel-package`: требование «Границы пакета названы зависимостями» переписано под раскладку peer и `dependencies`
- [ ] 1.3 Дельта `docs-package-readme`: требование о разделе установки

## 2. Манифесты: zod

- [ ] 2.1 `@nestlingjs/app`: `zod` в `peerDependencies` и `devDependencies`
- [ ] 2.2 `@nestlingjs/config.vault`, `@nestlingjs/inbox`, `@nestlingjs/outbox`: то же
- [ ] 2.3 `@nestlingjs/mcp`, `@nestlingjs/subscriptions`: то же
- [ ] 2.4 `@nestlingjs/transport.http`, `@nestlingjs/transport.nats`: то же
- [ ] 2.5 `@nestlingjs/drizzle.pg`: то же, рядом с уже объявленными `drizzle-orm` и `pg`
- [ ] 2.6 `yarn install` проходит без предупреждений о недостающих peer; пример, который не объявил используемое, объявляет

## 3. Манифест сателлита телеметрии

- [ ] 3.1 `@nestlingjs/otel`: `@opentelemetry/api`, `sdk-trace-base` и `sdk-metrics` в `peerDependencies` и `devDependencies`
- [ ] 3.2 `@opentelemetry/resources` и `semantic-conventions` остаются в `dependencies`
- [ ] 3.3 Счётные проверки `boundary.spec.ts` сателлита пересчитаны под новую раскладку

## 4. Проверка раскладки

- [ ] 4.1 `scripts/boundary/manifest-deps.mjs`: список исключений константой, у каждого имени причина
- [ ] 4.2 Скрипт читает `publishablePackages()`, отбрасывает скоуп `@nestlingjs`, сверяет остаток со списком
- [ ] 4.3 Сообщение называет пакет, зависимость и куда имя переносится
- [ ] 4.4 Вызов в `yarn verify` и `yarn verify:fresh` рядом с `public-api-validator.mjs`
- [ ] 4.5 Прогон на чистом дереве без `dist` проходит
- [ ] 4.6 Спека скрипта: лишнее имя ловится, имя из списка молчит, приватный пакет пропускается

## 5. Тексты

- [ ] 5.1 README затронутых пакетов: раздел установки называет, что ставится рядом, обе языковые половины
- [ ] 5.2 Глава установки гайда и её английская пара
- [ ] 5.3 `docs/design/` там, где названа раскладка зависимостей пакета
- [ ] 5.4 Плашки статуса README затронутых пакетов обновлены

## 6. Definition of Done

- [ ] 6.1 `yarn verify` зелёный
- [ ] 6.2 README затронутых пакетов обновлены, включая плашки статуса
- [ ] 6.3 `design/` и `decisions/` синхронизированы по правилам CLAUDE.md
- [ ] 6.4 Запись [ideas.md [2026-09-14]](../../../docs/decisions/ideas.md) «Зависимости пакетов: свой пакет в `dependencies`, библиотека в `peerDependencies`» несёт пометку «РЕАЛИЗОВАНО»
- [ ] 6.5 `yarn docs:audit` — 0 ERROR
- [ ] 6.6 Затронутые `examples/*` мигрированы, главы гайда пересверены с обновлённой датой в плашке «сверено с кодом»
- [ ] 6.7 Скилл `packages/nestling.agent-skill/skill/` обновлён, если change изменил публичные имена, формы вызова или состав пакетов
- [ ] 6.8 `main` не тронут — слияние делает Merger после `/opsx:archive`
