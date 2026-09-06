## 1. Линтер стиля

- [x] 1.1 Добавить в `BANNED` (`.claude/skills/docs-style/scripts/lint.mjs`)
      правило на голое «токен»: выражение
      `/(?<!DI-)(?<!Bearer-)(?<![а-яёa-z])[Тт]окен(а|у|ом|е|ы|ов|ам|ами|ах)?(?![а-яё])/iu`
      с подсказкой «„DI-токен“ — или „Bearer-токен“, если речь о токене
      доступа». Проверить на строках «проверяет токен», «по токену
      транспорта», «токенами», «access-токен» (находка) и «DI-токен»,
      «Bearer-токена», «семейство DI-токенов» (нет находки)
- [x] 1.2 Починить `DEFAULT_TARGETS`: `docs/guides` → `docs/guide`, добавить
      `docs/conventions.md`; убедиться, что прогон без аргументов проверяет
      больше 492 файлов
- [x] 1.3 Добавить строку про «токен» в таблицу замен
      `.claude/skills/docs-style/SKILL.md` (внутри блока `docs-style: off`)
- [x] 1.4 Сохранить вывод `node .claude/skills/docs-style/scripts/lint.mjs --json`
      как список работ для разделов 3–8

## 2. Bearer: места, где «токен» означает токен доступа

Правятся первыми, до сплошного прохода по DI-токенам.

- [x] 2.1 `docs/guide/09-auth.md`: проверка заголовка `authorization` —
      «Bearer-токен»; отбор endpoint'ов по транспорту — «DI-токен»
- [x] 2.2 `examples/users-service/src/auth.ts`,
      `examples/app-with-http/src/plugins/auth/*`: комментарии про
      `apiToken` и заголовок — «Bearer-токен»
- [x] 2.3 Тесты и e2e, где в заголовках стоит «токен» про
      `authorization` (`examples/*/src/app.spec.ts`,
      `examples/app-with-http/e2e/*`)

## 3. Словарь и соглашения

- [x] 3.1 `docs/glossary.md`: строка таблицы «семейство токенов» →
      «семейство DI-токенов»; сверить определение раздела о контейнере
- [x] 3.2 `docs/conventions.md` и `docs/README.md`: приставка у каждого
      вхождения

## 4. Гайд

- [x] 4.1 Главы 03, 04, 05, 06, 07, 08 — приставка у каждого вхождения,
      включая комментарии внутри блоков кода
- [x] 4.2 Главы 11, 12, 13, 15, 19, 20, 21
- [x] 4.3 Главы 22, 23, 24, 25, `README.md` гайда,
      `appendix-b-from-nestjs.md`
- [ ] 4.4 Прогнать `yarn docs:build`: сборка одного файла не падает,
      якоря глав не изменились

## 5. Design-доки

- [x] 5.1 `docs/design/`: `config.md`, `endpoints.md`, `operations.md`,
      `pipeline.md`, `schemas.md`, `testing.md`, `transports.md`

## 6. README пакетов

- [x] 6.1 `@nestling/container` (95 вхождений на десять README, больше
      всего здесь) и `@nestling/app`
- [x] 6.2 `@nestling/testing`, `@nestling/operations`, `@nestling/client`,
      `@nestling/openapi`, `@nestling/subscriptions`
- [x] 6.3 `@nestling/transport.http`, `@nestling/transport.cli`,
      `@nestling/transport.nats`

## 7. JSDoc, комментарии и заголовки тестов

- [x] 7.1 `packages/nestling.container/src` — 170 вхождений; начать с
      `providers/token-family.ts`, `builder/container.builder.ts`,
      `common.ts`, `tokens.ts`
- [x] 7.2 `packages/nestling.app/src` — 100 вхождений; начать с
      `pipeline/metadata/endpoint.ts`, `config/section.ts`,
      `root/feature.ts`, `transport/declaration.ts`
- [x] 7.3 `packages/nestling.testing/src` — 26 вхождений
- [x] 7.4 `packages/nestling.operations`, `nestling.transport.nats`,
      `nestling.transport.http`, `nestling.openapi`,
      `nestling.subscriptions`, `nestling.transport.cli`,
      `nestling.client`, `nestling.models`

## 8. Примеры

- [x] 8.1 `examples/container` — комментарии и заголовки тестов
- [x] 8.2 `examples/app-with-http`, `examples/users-service`,
      `examples/split-nats` — остальные вхождения после раздела 2

## 9. Сообщения об ошибках

- [x] 9.1 `@nestling/container`: `token` → `DI token` в текстах
      `container.builder.ts` и `container.built.ts` (около 30 мест)
- [x] 9.2 `common.graphs/src/dag.class.ts` и `@nestling/app`
      (`root/boundary.ts`, `root/feature.ts`,
      `pipeline/metadata/endpoint.ts`)
- [x] 9.3 Обновить тесты, которые сверяют тексты сообщений
      (`container.built.spec.ts`, `container.builder.spec.ts` и все, что
      найдёт `yarn test`)

## 10. Существующие находки линтера

- [x] 10.1 `провода` в `nestling.client/src/client.spec.ts`,
      `nestling.operations/src/status.ts` (две строки),
      `nestling.transport.http/src/client.integration.spec.ts`
- [x] 10.2 `уезжают` в `nestling.transport.nats/src/transport.spec.ts`

## 11. Полнота

- [x] 11.1 `node .claude/skills/docs-style/scripts/lint.mjs` — 0
      запрещённых слов
- [x] 11.2 Поиск `grep -rE "(^|[^-A-Za-zА-Яа-яёЁ])[Тт]окен"` по
      `docs/guide`, `docs/design`, `docs/glossary.md`,
      `docs/conventions.md`, `docs/README.md`, `packages`, `examples`,
      `README.ru.md` даёт только оправданные вхождения: перечисление
      запрещённых форм в блоке `docs-style: off` глоссария
- [ ] 11.3 Обновить `docs/decisions/roadmap.md`: строка 44 — **done** со
      ссылкой на архив; добавить абзац в `archlog.md`

## 12. Definition of Done

- [ ] 12.1 Все задачи выше отмечены
- [ ] 12.2 `yarn verify` зелёный
- [ ] 12.3 README затронутых пакетов обновлены, включая плашки статуса
- [ ] 12.4 `design/` и `decisions/` синхронизированы по правилам
      `CLAUDE.md`
- [ ] 12.5 `yarn docs:audit` — 0 ERROR
- [ ] 12.6 Затронутые `examples/*` мигрированы; главы гайда пересверены, и
      если сессия идёт позже 2026-09-06 — дата в плашке «сверено с кодом»
      обновлена
- [ ] 12.7 Коммиты осмысленные, ветка `change/docs-di-token` запушена
