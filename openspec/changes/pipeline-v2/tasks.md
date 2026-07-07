# pipeline-v2 — tasks

## 1. Ядро: типы (type-first)

- [x] 1.1 Типы юнитов: `PreUnit`/`OkUnit`/`CatchUnit`/`AfterUnit`/`FinallyUnit`
  (функция/инстанс/класс), `Outcome = 'completed' | 'disconnected' |
  'aborted' | 'failed'`; типы ctx ответного тракта
  (`TReq & Partial<TOwn>`); файл(ы) `core/types/unit.ts` взамен
  `middleware.before.ts`
- [x] 1.2 Билдер `makePipeline<TReq>()`: `Pipeline<TReq, TAcc, TNeeds>`,
  накопление `TAcc` в `.pre` (перенос машинерии
  `ConflictingKeys`/`ExtractAddition`), type-state (`.pre` недоступен
  после первого ответного метода), иммутабельность
- [x] 1.3 `compose(outer, ..., inner)`: попарная проверка
  `inner.TReq extends outer.TAcc` с читаемой ошибкой (паттерн
  `CheckMiddlewareCompatibility`), результат `TAcc`-пересечение +
  `TNeeds`-union; вариадическая форма
- [x] 1.4 Новые type-тесты (`pipeline.spec.ts` переписывается): перенос
  сценариев старых тестов (накопление, конфликты полей, порядок,
  переиспользование) на новый API + новые: type-state билдера,
  полный/Partial ctx по фазам, совместимая/несовместимая композиция,
  `TNeeds` (класс-юнит ⇒ не принимается транспортом, после `bind` —
  принимается); негативные случаи с проверкой сообщений

## 2. Ядро: рантайм

- [x] 2.1 Исполнение одного слоя в `executeWithHandler` (сигнатура
  сохраняется): pre по порядку → падение ⇒ ответная фаза с `Fail` →
  хендлер → ответные юниты по порядку с применимостью и заменой ответа;
  инъекция `meta.signal` и политика `exposeErrorDetails` — как сейчас
- [x] 2.2 Исполнение композиции: pre снаружи внутрь, ответные и `finally`
  изнутри наружу; слой не исполняется, если pre внешних упал
- [x] 2.3 `.finally` с исходом: вычисление из `meta.signal`
  (disconnected/aborted) и успешности ответа (completed/failed);
  вызов после ответной фазы (ограничение v1 — JSDoc)
- [x] 2.4 `bind(resolve)`: материализация классов-юнитов,
  `Pipeline<_, _, never>` на выходе
- [x] 2.5 Рантайм-тесты (`pipeline.runtime.spec.ts` переписывается):
  перенос текущих сценариев (нормализация Ok, meta.signal ×4,
  exposeErrorDetails ×4) + новые: порядок фаз при успехе/падении pre,
  замена ответа в `.catch`/`.after`, применимость `.ok`/`.catch`,
  Partial ctx на error-path, порядок слоёв, `finally` с каждым исходом,
  `bind` + инстанс-юниты

## 3. Метаданные и встроенные юниты

- [x] 3.1 `metadata/endpoint.ts`: тип `EndpointDefinition.pipeline` →
  новый Pipeline (`TNeeds = never` для standalone); проверить вывод типа
  меты в `IEndpoint`/`HandlerFn` (контракт «накопленный input без payload
  + signal» сохраняется)
- [x] 3.2 `middlewares/` → pre-юниты: `validate`, `withRequestId`,
  `withIdentity`, `withPermissions`, `withRequestLogging` (сигнатуры
  уже совпадают с формой pre; обновить типы и JSDoc)
- [x] 3.3 Удаление мёртвой ветки: `metadata/middleware.ts` (`@Middleware`),
  middleware-registry (`registerMiddleware`/`getAllMiddleware`/
  `clearMiddlewareRegistry`), `middleware.before.ts`; чистка экспортов
  `src/index.ts`/`core/index.ts`

## 4. Транспорты

- [x] 4.1 `transport.http`: типы в `transport.ts`/`helpers.ts`/`router.ts`
  (`Pipeline<_, _, never>` в definition); обе ветки `handle()` работают
  с новым рантаймом (вызов `executeWithHandler` не меняется)
- [x] 4.2 `transport.http/src/transport.integration.spec.ts`: миграция
  14 использований `definePipeline` → `makePipeline` (+`.pre(validate())`)
- [x] 4.3 `transport.cli`: `defaultPipeline` в конструкторе —
  `Pipeline<EmptyInput, _, never>`; `execute()` — миграция типов

## 5. App

- [x] 5.1 `#registerEndpoints`: `bind` пайплайна через контейнер
  (резолв классов-юнитов), ошибка старта с именем незарегистрированного
  юнита; тест в `app.spec.ts` (юнит-класс из модуля резолвится;
  незарегистрированный — падение до listen)
- [x] 5.2 Удаление `AppModule.middleware` из `module.ts`; чистка
  `clearMiddlewareRegistry` из тестов

## 6. Examples и доки

- [ ] 6.1 `examples.app-with-http`: `common/pipelines.ts`
  (`makePipeline().pre(validate())`), 9 endpoint'ов + спеки; e2e зелёные
- [ ] 6.2 `examples.simple-http-server` (3 хендлера + `withTiming`) и
  `examples.simple-cli` (default-pipeline + 2 endpoint'а); в одном из
  примеров показать ответный тракт (`.finally`-аудит или `.catch`-маппер)
  и композицию слоёв
- [ ] 6.3 Гайды: `http-functional.md` (раздел Middleware → юниты и фазы),
  `http-app-di.md`, `cli.md`; `docs/design/transports.md` (раздел
  Pipeline, убрать «Global Pipeline» из диаграммы); README
  `nestling.pipeline`; переписать `core/TYPE-TESTS.md`
- [ ] 6.4 Запись в `docs/decisions/archlog.md` (BREAKING: смена модели
  pipeline); статус #4 в `docs/decisions/roadmap.md`
