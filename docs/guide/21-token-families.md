# 21. Зависимости по имени и сбор вкладов из модулей

> Гайд по текущему API; сверено с кодом `container` (2026-09-07).
> Целевое описание: [design/container.md](../design/container.md), разделы
> «Семейства DI-токенов» и «Логгер ядра». Почему так: записи
> [ideas.md](../decisions/ideas.md) «Token families + модули без
> рантайм-инкапсуляции» [2026-07-06], «Multi-injection через token
> families: `Family.all`» [2026-07-10] и «Логгер ядра: `RootLogger$`,
> семейство `Logger$` с `.auto` и `child`» [2026-09-06].

Сервисам нужны счётчики: один считает вызовы, другой считает запросы к
базе. Счётчики одинаковы, различаются только именем, и регистрировать
отдельный провайдер на каждый не хочется. Вторая задача из той же
области: проверки здоровья регистрируют разные модули, а собирает их один
сервис, которому список проверок заранее не известен.

Обе задачи решает семейство токенов: один рецепт для многих зависимостей,
которые различаются параметром. На том же механизме построен логгер ядра
из главы [8](./08-logging.md).

## Семейство вместо токена

```typescript
// examples/container/src/counters/registry.ts
import { makeTokenFamily } from '@nestling/container';

/** Счётчик с именем: считает события одного вида */
export interface Counter {
  readonly name: string;
  readonly value: number;
  increment(): number;
}

export const Counter$ = makeTokenFamily<Counter, [name: string]>('Counter');
```

`makeTokenFamily<T, [param]>(id)` возвращает функцию-семейство. Вызов
`Counter$('users')` возвращает токен члена с идентификатором
`Counter:users`. Повторный вызов с тем же параметром возвращает тот же
токен. Член семейства работает везде, где работает обычный токен: в
`deps` класса, в зависимостях фабрики, в `container.get()`. Токен с тем
же именем, но созданный напрямую через `makeToken('Counter:users')`,
членом семейства не является: контейнер сообщает об отсутствующем
провайдере, потому что принадлежность семейству хранится полем токена, а
не строкой идентификатора.

Интерфейс называется `Counter`, семейство — `Counter$`, как токен
интерфейса из главы [5](./05-repository.md): семейство вызывается как
функция, и суффикс отличает его от интерфейса в импортах.

## Член как обычная зависимость

```typescript
// examples/container/src/users/users.service.ts (фрагмент)
@Component([UserRepository, Counter$('users'), Logger$('users')])
export class UserService {
  #repository: UserRepository;
  #calls: Counter;
  #logger: Logger;

  constructor(repository: UserRepository, calls: Counter, logger: Logger) {
    this.#repository = repository;
    this.#calls = calls;
    this.#logger = logger;
  }

  // …

  async getUsers(): Promise<string[]> {
    this.#calls.increment();

    return await this.#repository.findAll();
  }
}
```

Потребитель указывает члена в `deps` и получает его в конструкторе. Ни
регистрации провайдера для `Counter$('users')`, ни отдельного модуля для
этого не нужно. Рядом стоит `Logger$('users')` — член семейства логгера
ядра: тот же механизм, только рецепт зарегистрирован ядром.

## Один рецепт на всё семейство

```typescript
// examples/container/src/counters/counters.plugin.ts (фрагмент)
export const appCounters = makePlugin({
  name: 'app-counters',
  providers: [
    // Один рецепт на всё семейство: `name` — параметр запрошенного члена.
    // Префикс читается из секции конфига, как любая зависимость
    familyProvider(Counter$, (name) =>
      factoryProvider(
        Counter$(name),
        (config: Config<typeof AppConfig>) =>
          new InMemoryCounter(`${config.metricsPrefix}.${name}`),
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
неё префикс имени. Рецепт лежит в плагине, потому что счётчики нужны
каждому модулю; плагины описаны в главе [12](./12-features.md).

При `build()` контейнер делает четыре шага.

1. Собирает членов семейства, упомянутых в `deps` всех зарегистрированных
   провайдеров.
2. Вызывает рецепт один раз на каждый уникальный параметр.
3. Регистрирует результат как обычный провайдер.
4. Повторяет, пока появляются новые члены: провайдер из рецепта сам может
   зависеть от членов того же или другого семейства.

Дальше член ничем не отличается от провайдера, зарегистрированного
вручную. Узлом он становится при сборке, а значением — на INIT. Два
потребителя `Counter$('users')` получают один экземпляр: `UserService`
увеличивает счётчик, а `Demo` читает его значение. Член участвует в
проверке циклов, создаётся и освобождается в топологическом порядке
наравне с прочими узлами, попадает в `toJSON()` и визуализацию. Член, которого никто не запросил, не создаётся:
`container.get(Counter$('orphan'))` вернёт `null`.

Член, запрошенный в `deps`, для которого рецепт не зарегистрирован,
останавливает сборку с именем семейства и параметра. Рецепт, вернувший
провайдер для другого токена, тоже останавливает сборку: ошибка называет
семейство, параметр и фактический токен. Второй рецепт для того же
семейства — ошибка регистрации.

## Имя члена по потребителю: `.auto`

```typescript
// examples/container/src/users/users.repository.ts
@Component([Database$, Logger$.auto])
export class UserRepository {
  #database: Database;
  #logger: Logger;

  constructor(database: Database, logger: Logger) {
    this.#database = database;
    this.#logger = logger;
  }

  async findAll(): Promise<string[]> {
    this.#logger.info('Loading all users');

    const result = await this.#database.query('SELECT * FROM users');
    return result.map((row: any) => row.name);
  }
}
```

`Logger$.auto` в `deps` класса `UserRepository` превращается в
`Logger$('UserRepository')` в момент декорирования. Имя берётся из
`constructor.name`, поэтому во время выполнения ничего не вычисляется.
В выводе примера это запись
`INFO  UserRepository Loading all users`: область члена стоит в каждой
строке. Явный `Logger$('UserRepository')` и `.auto` в том же классе дают
один узел графа. `.auto` есть у любого семейства, `Counter$.auto` в том
числе.

Три ограничения `.auto`:

- он допустим только в `deps` класса с декоратором роли; в зависимостях
  фабрики класса-потребителя нет, и это ошибка регистрации с подсказкой
  написать явный вызов семейства;
- анонимный класс с пустым `constructor.name` даёт ошибку при
  декорировании;
- минификатор, который переименовывает классы, переименует и членов.
  Пакет рассчитан на серверный Node без минификации.

## Вклады из разных модулей: `.all`

Объявите семейство вкладов:

```typescript
// examples/container/src/health/registry.ts
export interface HealthCheck {
  readonly name: string;
  check(): Promise<string>;
}

export const HealthCheck = makeTokenFamily<HealthCheck, [name: string]>(
  'HealthCheck',
);
```

Вклад — обычный провайдер с токеном члена, зарегистрированный там, где
ему место:

```typescript
// examples/container/src/database/database.module.ts
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
// examples/container/src/api/api.module.ts (фрагмент)
classProvider(HealthCheck('api'), ApiHealthCheck),
```

Агрегатор зависит от `HealthCheck.all` и получает массив всех вкладов:

```typescript
// examples/container/src/health/health.service.ts (фрагмент)
@Component([HealthCheck.all, HealthConfig, Logger$.auto])
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
семейства логгеров: агрегат ничем не привилегирован. Тип зависимости —
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
  массив без дополнительных объявлений;
- провайдера с `provide: HealthCheck.all` не бывает: этот узел создаёт
  сборка, а ручная регистрация под тем же токеном — ошибка регистрации.

Модули в примере связаны через `dependsOn`, как в главе
[12](./12-features.md): `UsersModule` зависит от `DatabaseModule`, а
`AppModule` перечисляет остальные.

## Проверка

Запустите пример и прочитайте вывод. Каждая запись подписана областью
логгера, который её написал, отчёт о здоровье содержит оба вклада, а
последняя запись — счётчики из одного рецепта, каждый со своим значением:

```
2026-09-06T17:43:18.018Z INFO  UserRepository Loading all users
2026-09-06T17:43:18.019Z INFO  HealthService Running health checks checks=2 host=localhost:5432
2026-09-06T17:43:18.019Z INFO  app Health report=["database: ok","api: ok"]
2026-09-06T17:43:18.019Z INFO  app Counters demo.users=1 demo.queries=2
```

Префикс `demo` пришёл из секции конфига через рецепт: `metricsPrefix`
читается из `APP_METRICS_PREFIX`, который пример привязывает в `main.ts`.

В app-тесте семейство подменяется целиком, а не по члену:
`familyOverride(Counter$, () => …)` из `@nestling/testing` заменяет рецепт
до создания членов. Записи логгера перехватывает `spyLogger()` подменой
`RootLogger$`: глава [15](./15-testing-features.md).

```bash
yarn workspace @examples/container start:dev
# граф с членами семейств в браузере
yarn workspace @examples/container export-metadata
yarn workspace @examples/container visualize
```

Тот же пример читает конфиг из нескольких источников и меняет значения
без перезапуска: глава [22](./22-config-sources.md).
