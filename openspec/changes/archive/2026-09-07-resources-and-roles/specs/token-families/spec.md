## MODIFIED Requirements

### Requirement: makeTokenFamily creates memoized member tokens

`makeTokenFamily<T, Params>(name)` SHALL возвращать семейство токенов —
функцию, вызов которой `Family(param)` (в v1 `param: string`) возвращает
токен-член: объект с `id` вида `"<name>:<param>"` и полями принадлежности
`family` и `param`. Повторный вызов с тем же параметром SHALL возвращать тот
же токен и не создавать новой записи в реестре членов семейства. Члены
семейства SHALL быть полноценными `InjectionToken` — пригодными в deps
класса с декоратором роли, deps фабричных провайдеров и в
`container.get()`/`getOrThrow()`.

#### Scenario: Member token id and memoization

- **WHEN** создано семейство `ILogger = makeTokenFamily<ILoggerService, [scope: string]>('Logger')`
  и дважды вызвано `ILogger('users')`
- **THEN** оба вызова возвращают токен с id `"Logger:users"` и токены
  идентичны (одна запись в реестре членов)

#### Scenario: Member usable as ordinary injection token

- **WHEN** класс объявлен как `@Component([ILogger('users')])` и контейнер
  с зарегистрированным `familyProvider` собран и проинициализирован
- **THEN** зависимость инжектится в конструктор как обычная, а
  `container.getOrThrow(ILogger('users'))` возвращает тот же инстанс

### Requirement: Family members are ordinary graph nodes

Члены семейства, ставшие узлами графа, SHALL участвовать во всех
механизмах контейнера наравне с обычными узлами: узлом член становится на `build()`,
значением — на INIT; детекция циклов (включая циклы через членов
семейства); создание в топологическом порядке при `init()` и освобождение
ресурса в обратном при `destroy()`; наличие в графе
(`toJSON()`/`traverse()`).

#### Scenario: Cycle through a family member is detected

- **WHEN** рецепт `ILogger('a')` возвращает провайдер с dep `ServiceB`, а
  `ServiceB` объявляет dep `ILogger('a')`
- **THEN** `build()` бросает ошибку о циклической зависимости

#### Scenario: Захват и освобождение члена происходят по одному разу

- **WHEN** рецепт возвращает `classProvider` с классом-ресурсом и вызваны
  `container.init()` и затем `container.destroy()`
- **THEN** `acquire` члена вызван ровно один раз при `init()` и `release` —
  ровно один раз при `destroy()`
