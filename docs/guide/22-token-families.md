# 22. Зависимости по имени и сбор вкладов из модулей

> Гайд по текущему API; сверено с кодом `container` (2026-09-09).
> Целевое описание: [design/container.md](../design/container.md), разделы
> «Семейства DI-токенов» и «Логгер ядра». Почему так: записи
> [ideas.md](../decisions/ideas.md) «Token families + модули без
> рантайм-инкапсуляции» [2026-07-06], «Multi-injection через token
> families: `Family.all`» [2026-07-10], «Логгер ядра: `RootLogger$`,
> семейство `Logger$` с `.auto` и `child`» [2026-09-06] и «Пробы:
> `HealthCheck$` и `Health$` в ядре, транспорты адаптируют» [2026-09-06].

Сервисам нужны счётчики: один считает вызовы, другой считает запросы к
базе. Счётчики одинаковы, различаются только именем, и регистрировать
отдельный провайдер на каждый не хочется. Вторая задача из той же
области: проверки здоровья регистрируют разные модули, а собирает их один
сервис, которому список проверок заранее не известен.

Обе задачи решает семейство DI-токенов: один рецепт для многих
зависимостей, которые различаются параметром. На том же механизме
построен логгер ядра из главы [9](./09-logging.md).

## Семейство вместо DI-токена

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
`Counter$('users')` возвращает DI-токен члена с идентификатором
`Counter:users`. Повторный вызов с тем же параметром возвращает тот же
DI-токен. Член семейства работает везде, где работает обычный DI-токен: в
`deps` класса, в зависимостях фабрики, в `container.get()`. DI-токен с
тем же именем, но созданный напрямую через `makeToken('Counter:users')`,
членом семейства не является: контейнер сообщает об отсутствующем
провайдере, потому что принадлежность семейству хранится полем DI-токена,
а не строкой идентификатора.

Интерфейс называется `Counter`, семейство — `Counter$`, как DI-токен
интерфейса из главы [6](./06-repository.md): семейство вызывается как
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
каждому модулю; плагины описаны в главе [13](./13-features.md).

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
провайдер для другого DI-токена, тоже останавливает сборку: ошибка
называет семейство, параметр и фактический DI-токен. Второй рецепт для
того же семейства — ошибка регистрации.

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

Семейство вкладов в пробы объявляет ядро — `HealthCheck$(name)` из
`@nestling/app`. Своё объявлять не нужно: вклад пишется под членом
ядерного семейства, и его увидит узел проб.

Вклад — обычный класс с интерфейсом `HealthCheck`: признак критичности и
метод проверки. Имя проверки задаёт член семейства, поэтому в самом классе
имени нет:

```typescript
// examples/container/src/database/database.health.ts (фрагмент)
@Component([Database$, HealthConfig])
export class DatabaseHealthCheck implements HealthCheck {
  readonly critical = true;

  async check(_signal: AbortSignal): Promise<HealthStatus> {
    const rows = await this.#database.query('SELECT 1');

    return rows.length > 0 ? 'ok' : 'down';
  }
}
```

Регистрируется он обычным провайдером с DI-токеном члена — там, где ему
место:

```typescript
// examples/container/src/database/database.module.ts
export const DatabaseModule = makeModule({
  name: 'module:database',
  providers: [
    classProvider(Database$, InMemoryDatabase),
    classProvider(HealthCheck$('database'), DatabaseHealthCheck),
  ],
});
```

Второй вклад лежит в другом модуле, и первый модуль для него менять не
пришлось:

```typescript
// examples/container/src/api/api.module.ts (фрагмент)
classProvider(HealthCheck$('api'), ApiHealthCheck),
```

Состояние приложения целиком отдаёт узел ядра `Health$`: он собирает
исходы вкладов в отчёт, считает итог по фазе и критичности и кэширует
прогон. Обычному приложению этого достаточно — глава
[24](./24-ops.md) показывает пробы на HTTP.

Но `.all` работает и на ядерном семействе: зависимость от
`HealthCheck$.all` даёт массив всех вкладов, где бы они ни были
зарегистрированы.

```typescript
// examples/container/src/demo.ts (фрагмент)
@Component([Health$, HealthCheck$.all, /* … */])
export class Demo {
  constructor(
    private readonly health: Health,
    private readonly checks: readonly HealthCheck[],
    // …
  ) {}
}
```

`HealthCheck$.all` стоит в `deps` рядом с узлом и членом семейства
логгеров: агрегат ничем не привилегирован. Тип зависимости —
`readonly HealthCheck[]`.

При `build()`, когда рецепты перестали создавать новых членов, контейнер
регистрирует узел-агрегат. Его зависимости — DI-токены всех членов
семейства, у которых есть провайдер, а значение — массив их экземпляров.
Дальше это обычный узел графа: вклады инициализируются раньше агрегатора
и уничтожаются позже.

Правила агрегата:

- в массив попадает каждый член с провайдером: явные вклады, члены из
  рецепта, члены из `.auto`; рецепт семейству не обязателен;
- `.all` не создаёт членов; вызов `HealthCheck$('orphan')` без провайдера
  в массив не попадает;
- пустое семейство даёт пустой массив, а не ошибку: фичу не выбрали, и
  её вкладов нет;
- порядок элементов совпадает с порядком регистрации, сначала явные
  вклады, затем члены из рецепта; на порядок `dependsOn` не опирайтесь;
- массив заморожен и общий для всех потребителей `.all`;
- узел-агрегат не принадлежит модулю, и вклад чужого модуля попадает в
  массив без дополнительных объявлений;
- провайдера с `provide: HealthCheck$.all` не бывает: этот узел создаёт
  сборка, а ручная регистрация под тем же DI-токеном — ошибка
  регистрации.

Модули в примере связаны через `dependsOn`, как в главе
[13](./13-features.md): `UsersModule` зависит от `DatabaseModule`, а
`AppModule` перечисляет остальные.

## Проверка

Запустите пример и прочитайте вывод. Каждая запись подписана областью
логгера, который её написал, агрегат содержит оба вклада, а последняя
запись — счётчики из одного рецепта, каждый со своим значением:

```
2026-09-08T22:26:13.997Z INFO  UserRepository Loading all users
2026-09-08T22:26:13.997Z INFO  app Health checks critical=1 total=2
2026-09-08T22:26:13.997Z INFO  app Health report={"status":"not_ready","phase":"START","checks":[]}
2026-09-08T22:26:13.997Z INFO  app Counters demo.users=1 demo.queries=1
```

Итог здесь `not_ready`, и список проверок пуст: `@OnStart` выполняется на
фазе START, а готовность наступает только в RUN. Само это и есть правило
узла — до RUN и на SHUTDOWN проверки не запускаются вовсе.

Префикс `demo` пришёл из секции конфига через рецепт: `metricsPrefix`
читается из `APP_METRICS_PREFIX`, который пример привязывает в `main.ts`.

В app-тесте семейство подменяется целиком, а не по члену:
`familyOverride(Counter$, () => …)` из `@nestling/testing` заменяет рецепт
до создания членов. Записи логгера перехватывает `spyLogger()` подменой
`RootLogger$`: глава [16](./16-testing-features.md).

```bash
yarn workspace @examples/container start:dev
# граф с членами семейств в браузере
yarn workspace @examples/container export-metadata
yarn workspace @examples/container visualize
```

Тот же пример читает конфиг из нескольких источников и меняет значения
без перезапуска: глава [23](./23-config-sources.md).
