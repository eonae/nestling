# container-fixes — tasks

## 1. Атрибуция модуля для функциональных провайдеров (nestling.container)

- [x] 1.1 `container.builder.ts` → `appendFactoryProviders()`: итерировать `#providersFactories` по `entries()` и вызывать `registerProvider(provider, moduleName)` (передать имя модуля из ключа Map)
- [x] 1.2 Рантайм-тест в `container.builder.spec.ts`: модуль с `providers`-функцией (sync и async) → у полученных узлов в графе `metadata.module === '<имя модуля>'`; экспортированный из такого модуля токен → `metadata.exported === true`, неэкспортированный → `false`

## 2. Идемпотентность lifecycle-метаданных (nestling.container)

- [x] 2.1 `lifecycle.ts` → `@OnInit`/`@OnDestroy`: дедупликация по имени метода перед `push` (запись один раз на метод класса, независимо от числа инстансов)
- [x] 2.2 Рантайм-тест в `lifecycle.spec.ts`: создать N (≥3) инстансов класса с `@OnInit`/`@OnDestroy` → `getLifecycleHooks(instance).onInit`/`.onDestroy` содержат каждый хук ровно один раз (длина не растёт с числом инстансов)

## 3. Контракт accessor'ов `BuiltContainer` (nestling.container)

- [x] 3.1 `container.built.ts`: переписать JSDoc `get()` под фактическое поведение (возврат `T | null`, `null` при отсутствии токена, убрать `@throws`)
- [x] 3.2 `container.built.ts`: добавить JSDoc `getOrThrow()` и заменить `if (!instance)` на проверку наличия узла в графе, чтобы falsy-значения (`0`, `''`, `false`) не считались отсутствием
- [x] 3.3 Рантайм-тесты в `container.built.spec.ts`: `get()` на незарегистрированном токене → `null` (без throw); `getOrThrow()` на незарегистрированном → бросает; `getOrThrow()` на `useValue: 0` → возвращает `0` (не бросает)

## 4. Финализация

- [x] 4.1 `yarn test` в `@nestling/container` — все тесты зелёные
- [x] 4.2 Обновить статус change в `docs/decisions/roadmap.md` (строка 2) после apply/archive
