## 1. Ядро: две формы хендлера (`@nestling/pipeline`)

- [ ] 1.1 `src/metadata/endpoint.ts`: удалить `HandlerWithDeps`, `HandlerFactory` и ветку объектной формы в `AnyEndpointHandler`; `EndpointDefinition.handler` — `HandlerFn | HandlerClass`; `TNeeds` класс-формы — конструктор, функции — `never`
- [ ] 1.2 `makeEndpoint`: нормализация двух форм по значению (функция без `handle` в прототипе — хендлер, с `handle` — класс); объект в `handler` — `TypeError` с паттерном endpoint'а и подсказкой «класс с `@Injectable` и методом `handle`»; поля `deps`/`handle` на верхнем уровне словаря — ошибка, как прежде
- [ ] 1.3 `resolve`: единственная сигнатура с резолвером; удалить позиционную перегрузку, `resolveWith` по `state.deps` и само поле `deps` состояния; резолвер создаёт инстанс класса-хендлера и связывает пайплайн; позиционный массив из JS — ошибка, называющая форму с резолвером
- [ ] 1.4 Удалить функцию чтения зависимостей объектной формы (`handlerDependenciesOf` или её аналог), оставить `handlerClassOf`; обновить экспорты `index.ts`
- [ ] 1.5 Рантайм-тесты: обе формы исполняются; объект отвергается с текстом; `resolve` резолвером создаёт инстанс и связывает классы-юниты; два endpoint'а с одним классом делят экземпляр (через `App`, см. 2.4)
- [ ] 1.6 `type-tests`: фикстуры и снапшоты, использовавшие объектную форму, переписаны на класс или функцию; `yarn workspace @nestling/pipeline type-budget` — без сдвига порогов

## 2. Конструкторы деклараций и сборка

- [ ] 2.1 `@nestling/transport.http` `helpers.ts`: `httpEndpoint` — четыре перегрузки (форма с операцией и анонимная, для функции и класса), форма с операцией первой; JSDoc перегрузок
- [ ] 2.2 `@nestling/transport.cli`: `cliEndpoint` — две перегрузки
- [ ] 2.3 `@nestling/ports` `implement.ts`: две перегрузки; `ImplementDictionary` без объектной формы
- [ ] 2.4 `@nestling/app`: discovery и регистрация класса-хендлера без чтения `deps` с объекта; ошибки «класс и в `handler`, и в `providers:`» и «зависимость класса не зарегистрирована» сохраняют тексты; тесты сборки обновлены
- [ ] 2.5 `yarn verify` по пакетам `pipeline`, `transport.http`, `transport.cli`, `ports`, `app`

## 3. `@Injectable`: длина списка зависимостей (`@nestling/container`)

- [ ] 3.1 Тип декоратора: длина списка — допустимая длина `ConstructorParameters<T>` (необязательные параметры — объединение длин, rest — любая); нарушение — литерал `__error` с ожидаемой и фактической длиной; проверка типов и порядка не меняется
- [ ] 3.2 Рантайм: `deps.length < constructor.length` — `TypeError` при декорировании с именем класса, ожидаемым и фактическим числом; лишние токены рантаймом не проверяются
- [ ] 3.3 Тесты: `// @ts-expect-error` на лишний и недостающий токен, компиляция необязательных, rest и перегруженных конструкторов; рантайм-тесты нехватки и параметра со значением по умолчанию
- [ ] 3.4 Ослабить проверку до «не длиннее максимальной длины», если перегруженные конструкторы дают ложное срабатывание; зафиксировать выбор в README пакета

## 4. Type-tests в `@nestling/transport.http`

- [ ] 4.1 Каталог `type-tests/`: `tsconfig.json`, `support/compile.ts` и `support/fixture-kit.ts` (копия из `pipeline` с комментарием-ссылкой на оригинал), `diagnostics.spec.ts`, `__snapshots__`; каталог в `tsconfig.json` пакета, вне `tsconfig.build.json`, фикстуры в `ignores` ESLint
- [ ] 4.2 Фикстуры: `function-wrong-output`, `class-wrong-output`, `function-undeclared-fail`, `class-undeclared-fail`, `class-wrong-input`, `operation-redeclared-input`, `object-form-removed`
- [ ] 4.3 Снапшоты записаны и прочитаны: первая строка каждой диагностики называет проблему; спек входит в `yarn test` пакета

## 5. Примеры

- [ ] 5.1 `docs/conventions.md`: правило именования класса-хендлера реализации операции и подписчика события, имя файла; реализации, объявленные инлайн в файле фичи, выносятся по файлам, если их больше одной
- [ ] 5.2 `examples.app-with-http`: все места `handler: { deps, handle }` (`grep -rn 'deps: \[' src`) — классы с `@Injectable`; `quotas.feature.ts` разложен по файлам; `createUserHandler` становится классом `CreateUserHandler`
- [ ] 5.3 `examples.split-nats`, `examples.container`, `examples.simple-cli`, `examples.users-service`, `examples.simple-http-server`: остальные места; юнит-тесты хендлеров — через `new`
- [ ] 5.4 `yarn workspace <пример> test` и e2e зелёные для каждого затронутого примера; `yarn verify`

## 6. Гайд и README

- [ ] 6.1 Глава 5: раздел «Провайдеры без класса» без сниппета `handler: { deps }`; абзац про лишний токен — теперь ошибка компиляции; README гайда — строка таблицы «Список зависимостей совпадает с параметрами конструктора» дополнена длиной
- [ ] 6.2 Главы 12, 13, 17 и все главы, где `grep -rn 'deps: \[' docs/guide` находит форму хендлера (проверить 14, 19, 20, 23, 24): сниппеты — классы; даты плашек «сверено с кодом» после сверки
- [ ] 6.3 Приложение А: строка таблицы и раздел «Функция с `deps`» удалены, `resolve` позиционной формой не упоминается; приложение В — строки удалённых сниппетов; приложение Б — строка про `@Controller`
- [ ] 6.4 README пакетов `pipeline`, `transport.http`, `transport.cli`, `ports`, `app`, `container`: таблицы форм хендлера, `@Injectable`, плашки статуса
- [ ] 6.5 `docs/glossary.md`: «Хендлер — поле `handler` endpoint'а: функция или класс с методом `handle`»

## 7. Документация и спеки

- [ ] 7.1 `design/endpoints.md` §3 и `design/container.md` сверены с реализованным; Purpose спеки `endpoint-handler-di` — две формы (правится при archive вместе с дельтой)
- [ ] 7.2 `ideas.md`: пометка «РЕАЛИЗОВАНО» с уточнениями по факту в записях «Две формы хендлера» и «`@Injectable` сверяет длину списка»; статус #33 в `roadmap.md`
- [ ] 7.3 `node .claude/skills/docs-style/scripts/lint.mjs` по изменённым текстам — 0

## 8. Definition of Done

- [ ] 8.1 Все задачи выше отмечены
- [ ] 8.2 `yarn verify` зелёный (build + typecheck + lint + test + type-budget)
- [ ] 8.3 README затронутых пакетов обновлены, включая плашки статуса
- [ ] 8.4 `design/` и `decisions/` синхронизированы по правилам CLAUDE.md
- [ ] 8.5 `yarn docs:audit` — 0 ERROR
- [ ] 8.6 Примеры мигрированы, гайды пересверены с обновлённой датой в плашке «сверено с кодом»
- [ ] 8.7 Линтер стиля по изменённым текстам — 0 запрещённых слов
- [ ] 8.8 Коммиты осмысленные, ветка запушена
