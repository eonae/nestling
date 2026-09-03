# 21. Логгер с именем потребителя и сбор вкладов из модулей

> Гайд по текущему API; сверено с кодом `examples.container` (2026-09-03).
> Целевое описание: [design/container.md](../design/container.md), раздел
> «Семейства токенов». Почему так: записи [ideas.md](../decisions/ideas.md)
> «Token families + модули без рантайм-инкапсуляции» [2026-07-06] и
> «Multi-injection через token families: `Family.all`» [2026-07-10].

## Задача

Каждому сервису нужен логгер, который подписывает записи именем этого
сервиса. Регистрировать отдельный провайдер логгера на каждый сервис не
хочется. Вторая задача из той же области: проверки здоровья регистрируют
разные модули, а собирает их один сервис, которому список проверок заранее
не известен.

Обе задачи решает семейство токенов: один рецепт для многих зависимостей,
которые различаются параметром.

## Решение

### Объявите семейство вместо токена

```typescript
// packages/examples.container/src/logging/registry.ts
import { makeTokenFamily } from '@nestling/container';

export interface Logger {
  log(...args: unknown[]): void;
}

export const Logger = makeTokenFamily<Logger, [scope: string]>('Logger');
```

`makeTokenFamily<T, [param]>(id)` возвращает функцию-семейство. Вызов
`Logger('users')` возвращает токен члена с идентификатором `Logger:users`.
Повторный вызов с тем же параметром возвращает тот же токен. Член
семейства работает везде, где работает обычный токен: в `deps` класса, в
зависимостях фабрики, в `container.get()`.

Интерфейс и семейство носят одно имя. В отличие от токена интерфейса из
главы [5](./05-repository.md), суффикс `$` здесь не нужен: семейство
вызывается как функция, и спутать его с интерфейсом в коде нельзя.

### Запросите члена как обычную зависимость

```typescript
// packages/examples.container/src/users/users.service.ts
@Injectable([UserRepository, Logger('users')])
export class UserService {
  #repository: UserRepository;
  #logger: Logger;

  constructor(repository: UserRepository, logger: Logger) {
    this.#repository = repository;
    this.#logger = logger;
  }
  // …
}
```

Потребитель указывает члена в `deps` и получает его в конструкторе. Ни
регистрации провайдера для `Logger('users')`, ни отдельного модуля для
этого не нужно.

### Зарегистрируйте один рецепт на всё семейство

```typescript
// packages/examples.container/src/logging/logging.plugin.ts
export const appLogging = makePlugin({
  name: 'app-logging',
  providers: [
    // …
    familyProvider(Logger, (scope) =>
      factoryProvider(
        Logger(scope),
        (config: Config<typeof AppConfig>) => ({
          log: (...args: unknown[]) =>
            // …
            console.log(`[${config.logLevel}] Logger:${scope}`, ...args),
        }),
        [AppConfig] as const,
      ),
    ),
  ],
});
```

`familyProvider(family, recipe)` регистрирует рецепт. Рецепт получает
параметр члена и возвращает обычное определение провайдера:
`factoryProvider`, `classProvider` или `valueProvider`. У провайдера из
рецепта есть свои `deps`: здесь член зависит от секции конфига и читает из
неё уровень логирования. Рецепт лежит в плагине, потому что логгер нужен
каждому модулю; плагины описаны в главе [12](./12-features.md).

При `build()` контейнер делает четыре шага.

1. Собирает членов семейства, упомянутых в `deps` всех зарегистрированных
   провайдеров.
2. Вызывает рецепт один раз на каждый уникальный параметр.
3. Регистрирует результат как обычный провайдер.
4. Повторяет, пока появляются новые члены: провайдер из рецепта сам может
   зависеть от членов того же или другого семейства.

Дальше член ничем не отличается от провайдера, зарегистрированного
вручную. Он создаётся при сборке. Два потребителя `Logger('users')`
получают один экземпляр. Он участвует в проверке циклов, получает
`@OnInit` и `@OnDestroy` в топологическом порядке, попадает в `toJSON()`
и визуализацию. Член, которого никто не запросил, не создаётся:
`container.get(Logger('orphan'))` вернёт `null`.

### Назовите члена по потребителю: `.auto`

```typescript
// packages/examples.container/src/users/users.repository.ts
@Injectable([Database$, Logger.auto])
export class UserRepository {
  #database: Database;
  #logger: Logger;

  constructor(database: Database, logger: Logger) {
    this.#database = database;
    this.#logger = logger;
  }
  // …
}
```

`Logger.auto` в `deps` класса `UserRepository` превращается в
`Logger('UserRepository')` в момент декорирования. Имя берётся из
`constructor.name`, поэтому во время выполнения ничего не вычисляется.
В выводе примера это строка
`[debug] Logger:UserRepository Loading all users`. Явный
`Logger('UserRepository')` и `.auto` в том же классе дают один узел графа.

Три ограничения `.auto`:

- он допустим только в `deps` класса с `@Injectable`; в зависимостях
  фабрики класса-потребителя нет, и это ошибка регистрации;
- анонимный класс с пустым `constructor.name` даёт ошибку при
  декорировании;
- минификатор, который переименовывает классы, переименует и членов.
  Пакет рассчитан на серверный Node без минификации.

### Соберите вклады из разных модулей: `.all`

Объявите семейство вкладов:

```typescript
// packages/examples.container/src/health/registry.ts
export interface HealthCheck {
  readonly name: string;
  check(): Promise<string>;
}

export const HealthCheck = makeTokenFamily<HealthCheck, [name: string]>(
  'HealthCheck',
);
```

Зарегистрируйте вклад там, где ему место. Вклад — обычный провайдер с
токеном члена:

```typescript
// packages/examples.container/src/database/database.module.ts
export const DatabaseModule = makeModule({
  name: 'module:database',
  providers: [
    classProvider(Database$, InMemoryDatabase),
    classProvider(HealthCheck('database'), DatabaseHealthCheck),
  ],
});
```

Второй вклад лежит в другом модуле, и первый модуль для него менять не
пришлось:

```typescript
// packages/examples.container/src/api/api.module.ts
    classProvider(HealthCheck('api'), ApiHealthCheck),
```

Агрегатор зависит от `HealthCheck.all` и получает массив всех вкладов:

```typescript
// packages/examples.container/src/health/health.service.ts
@Injectable([HealthCheck.all, HealthConfig, Logger.auto])
export class HealthService {
  #checks: readonly HealthCheck[];
  #config: Config<typeof HealthConfig>;
  #logger: Logger;

  constructor(
    checks: readonly HealthCheck[],
    config: Config<typeof HealthConfig>,
    logger: Logger,
  ) {
    this.#checks = checks;
    this.#config = config;
    this.#logger = logger;
  }

  async report(): Promise<string[]> {
    // …
    return await Promise.all(
      this.#checks.map(
        async (check) => `${check.name}: ${await check.check()}`,
      ),
    );
  }
}
```

`HealthCheck.all` стоит в `deps` рядом с секцией конфига и членом
семейства логгеров: агрегат ничем не привилегирован. Тип зависимости
`readonly HealthCheck[]`.

При `build()`, когда рецепты перестали создавать новых членов, контейнер
регистрирует узел-агрегат. Его зависимости — токены всех членов семейства,
у которых есть провайдер, а значение — массив их экземпляров. Дальше это
обычный узел графа: вклады инициализируются раньше агрегатора и
уничтожаются позже.

Правила агрегата:

- в массив попадает каждый член с провайдером: явные вклады, члены из
  рецепта, члены из `.auto`; рецепт семейству не обязателен;
- `.all` не создаёт членов; вызов `HealthCheck('orphan')` без провайдера
  в массив не попадает;
- пустое семейство даёт пустой массив, а не ошибку: фичу не выбрали, и
  её вкладов нет;
- порядок элементов совпадает с порядком регистрации, сначала явные
  вклады, затем члены из рецепта; на порядок `dependsOn` не опирайтесь;
- массив заморожен и общий для всех потребителей `.all`;
- узел-агрегат не принадлежит модулю, и вклад чужого модуля попадает в
  массив без дополнительных объявлений.

Модули в примере связаны через `dependsOn`, как в главе
[12](./12-features.md): `UsersModule` зависит от `DatabaseModule`, а
`AppModule` перечисляет остальные.

## Что гарантирует фреймворк

Все проверки ниже выполняются на `build()`, до запуска приложения.

- Член запрошен, а рецепт семейства не зарегистрирован: сборка
  останавливается с именем семейства и параметра.
- Рецепт вернул провайдер для другого токена: ошибка с именем семейства,
  параметром и фактическим токеном.
- Два рецепта на одно семейство: ошибка регистрации.
- `makeToken('Logger:users')` членом семейства не является: контейнер
  сообщает об отсутствующем провайдере. Принадлежность хранится полем
  токена, а не строкой идентификатора.
- `.auto` в зависимостях фабрики: ошибка регистрации с подсказкой написать
  явный вызов семейства.
- Провайдер с `provide: HealthCheck.all`: ошибка регистрации, этот узел
  создаёт сборка.

## Как проверить

Запустите пример и прочитайте вывод. Каждая строка подписана членом
семейства, который её написал, а отчёт о здоровье содержит оба вклада:

```
[debug] Logger:UserRepository Loading all users
[debug] Logger:HealthService Running 2 health checks against localhost:5432
[debug] Logger:app CheckHealth: [ 'database: ok', 'api: ok' ]
```

В app-тесте семейство подменяется целиком, а не по члену:
`familyOverride(Logger, () => …)` из `@nestling/testing` заменяет рецепт
до создания членов. Подробнее в главе [15](./15-testing-features.md).

## Запускаемый код

- `packages/examples.container/src/logging/registry.ts`,
  `logging/logging.plugin.ts`: семейство логгеров и его рецепт;
- `users/users.service.ts`, `users/users.repository.ts`: член по параметру
  и член по имени потребителя;
- `health/registry.ts`, `health/health.service.ts`,
  `database/database.module.ts`, `api/api.module.ts`: вклады и агрегатор.

```bash
yarn workspace examples.container start:dev
# граф с членами семейств в браузере
yarn workspace examples.container export-metadata
yarn workspace examples.container visualize
```

## Дальше

Тот же пример читает конфиг из нескольких источников и меняет значения
без перезапуска: глава [22](./22-config-sources.md).
