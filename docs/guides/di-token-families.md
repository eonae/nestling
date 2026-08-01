# Семейства токенов в DI

> Гайд по **текущему API**; сверено с кодом `examples.simple-app` (2026-08-01).

Параметризованные зависимости — логгер на скоуп, клиент на upstream, очередь на
имя — в Nestling делаются **семейством токенов**: один рецепт, много членов,
адресуемых параметром. Никакой рантайм-резолюции: билдер видит все запрошенные
члены на `build()` и материализует их обычными узлами графа.

## Семейство — это функция

```typescript
// packages/examples.simple-app/src/logging/registry.ts
import { makeTokenFamily } from '@nestling/container';

export interface ILogger {
  log(...args: unknown[]): void;
}

export const ILogger = makeTokenFamily<ILogger, [scope: string]>('Logger');
```

`ILogger('users')` возвращает обычный мемоизированный токен с id `Logger:users`.
Повторный вызов с тем же параметром даёт тот же токен. Член — полноценный
`InjectionToken`: годится в deps `@Injectable`, в deps фабричного провайдера
и в `container.get()`/`getOrThrow()`.

Экспорт `const` + `interface` под одним именем — обычный приём: `ILogger` как
значение это семейство, `ILogger` как тип — интерфейс сервиса.

## Один рецепт на всё семейство

Провайдер регистрируется не на каждого члена, а на семейство целиком:

```typescript
// packages/examples.simple-app/src/logging/logging.module.ts
import { factoryProvider, familyProvider, makeModule } from '@nestling/container';

import { AppConfig } from '../config/app.config';
import { ILogger } from './registry';

export const LoggingModule = makeModule({
  name: 'module:logging',
  providers: [
    familyProvider(ILogger, (scope) =>
      factoryProvider(
        ILogger(scope),
        (config: Config<typeof AppConfig>) => ({
          log: (...args) =>
            console.log(`[${config.logLevel}] Logger:${scope}`, ...args),
        }),
        [AppConfig] as const,
      ),
    ),
  ],
  exports: [ILogger],
});
```

Рецепт — обычный провайдер, поэтому у него есть свои `deps`: здесь член
семейства зависит от секции конфига (см. [config.md](./config.md)).

Рецепт — `(param) => ProviderDefinition<T>`: возвращает обычное определение
(`valueProvider` / `factoryProvider` / `classProvider`), поэтому в тестах член
подменяется тем же словарём, что и любой другой провайдер. Билдер проверяет, что
`provide` результата совпадает с токеном члена, — иначе сборка падает с указанием
семейства, параметра и фактического токена.

`familyProvider(...)` принимается и в `providers` модуля (массивом или фабрикой),
и напрямую в `builder.register(...)`. Второй рецепт для того же семейства —
ошибка регистрации.

## Что делает `build()`

1. Собирает все члены зарегистрированных семейств, упомянутые в deps
   зарегистрированных провайдеров.
2. Вызывает рецепт **ровно один раз на уникальный параметр**.
3. Регистрирует результат обычным провайдером — с именем модуля, в котором
   зарегистрирован рецепт.
4. Повторяет, пока появляются новые члены (провайдер из рецепта сам может
   зависеть от членов того же или другого семейства).

Дальше член ничем не отличается от провайдера, зарегистрированного руками: жадное
инстанцирование, дедупликация (два потребителя `ILogger('users')` получают один
инстанс), проверка циклов, `@OnInit`/`@OnDestroy` в топологическом порядке,
атрибуция к модулю, попадание в `toJSON()` и визуализацию.

Член, которого никто не запросил, **не создаётся**: `container.get()` вернёт для
него `null`. Материализация идёт от deps, а не от порядка импортов — сборка
детерминирована относительно зарегистрированного.

**Правило: члены создаются только вызовом семейства.** `makeToken('Logger:users')`
даёт похожую строку, но не члена; контейнер сообщит об отсутствующем провайдере
и подскажет, на какое семейство это похоже.

## `.auto` — логгер, названный по потребителю

```typescript
// packages/examples.simple-app/src/users/users.repository.ts
@Injectable([IDatabase, ILogger.auto])
export class UserRepository {
  constructor(database: IDatabase, logger: ILogger) { /* ... */ }
}
```

`ILogger.auto` — сентинел, который `@Injectable` заменяет на
`ILogger('UserRepository')` в момент декорирования: потребитель известен
статически, в рантайме ничего не резолвится. В логах примера это видно строкой
`[LOG] Logger:UserRepository Loading all users`.

Ограничения v1:

- `.auto` допустим только в deps классового `@Injectable`. В deps фабричного
  провайдера класса-потребителя нет — это ошибка регистрации с подсказкой
  использовать явный вызов `ILogger('<имя>')`.
- Класс с пустым `constructor.name` (анонимный) — ошибка при декорировании.
- Id члена берётся из `constructor.name`, поэтому минификация с переименованием
  классов переименовала бы и членов. Целевая среда — серверный Node.

`.auto`-член и явный `ILogger('UserRepository')` — один и тот же узел графа.

## `.all` — массив всех вкладов (multi-injection)

Обратная задача к рецепту: вкладов много, регистрируются они независимо разными
модулями, а потребитель один и состава не знает — health-check'и, миграции,
валидаторы. **Вклад — обычный провайдер с членским токеном**, никакого
центрального списка:

```typescript
// packages/examples.simple-app/src/health/registry.ts
export interface IHealthCheck {
  readonly name: string;
  check(): Promise<string>;
}

export const IHealthCheck = makeTokenFamily<IHealthCheck, [name: string]>(
  'HealthCheck',
);
```

```typescript
// packages/examples.simple-app/src/database/database.module.ts
export const DatabaseModule = makeModule({
  name: 'module:database',
  providers: [
    classProvider(IDatabase, Database),
    classProvider(IHealthCheck('database'), DatabaseHealthCheck),
  ],
  exports: [IDatabase, IHealthCheck],
});
```

Второй вклад живёт в `ApiModule` — `classProvider(IHealthCheck('api'), ApiHealthCheck)`;
чтобы его добавить, первый модуль править не пришлось.

Агрегатор зависит от сентинела `IHealthCheck.all`, типизированного как
`TokenString<readonly IHealthCheck[]>`:

```typescript
// packages/examples.simple-app/src/health/health.service.ts
@Injectable([IHealthCheck.all, HealthConfig, ILogger.auto])
export class HealthService {
  constructor(
    checks: readonly IHealthCheck[],
    config: Config<typeof HealthConfig>,
    logger: ILogger,
  ) { /* ... */ }
}
```

Сентинел стоит в `deps` рядом с обычными токенами — секцией конфига и членом
семейства логгеров: агрегат ничем не привилегирован.

Вывод прогона показывает оба вклада: `Running 2 health checks against db:5432`
и `Health: [ 'database: ok', 'api: ok' ]`.

### Что делает `build()`

После фикспоинта материализации членов билдер регистрирует **синтетический
узел-агрегат**: его deps — токены всех зарегистрированных членов семейства,
инстанс — массив их инстансов. Дальше это обычный узел графа: проверка циклов
(в том числе `агрегат → член → агрегат`), топологические `init()`/`destroy()`,
`toJSON()` и визуализация, `strictExports`.

- **Состав** — все члены, у которых на этот момент есть провайдер: явные вклады,
  члены, материализованные рецептом из deps, и члены из `.auto`. Рецепт
  семейству **не обязателен** — семейство с одними явными вкладами агрегируется
  штатно.
- **`.all` не форсит материализацию.** Член, созданный вызовом
  `IHealthCheck('orphan')`, но никем не запрошенный и без явного провайдера, в
  массив не попадёт и узла не получит. Иначе агрегат материализовал бы всё, что
  кто-либо где-либо вызвал при импорте.
- **Неупомянутый `.all` не создаёт узла** — `container.get(IHealthCheck.all)`
  вернёт `null`.
- **Пустое семейство → пустой массив**, а не ошибка: «фичу не выбрали, её вкладов
  нет» — штатное состояние. Опечатка в семействе выглядит так же, поэтому узел
  агрегата с пустыми deps виден в `toJSON()` и визуализации.
- **Порядок — порядок регистрации**: модули и провайдеры в порядке регистрации,
  затем члены, добавленные фикспоинтом. Порядок детерминирован, и больше ничего
  не обещано — если он несёт смысл (цепочка middleware), не опирайтесь на
  порядок `imports`.
- **Массив `readonly` и заморожен**: это снапшот сборки, общий для всех
  потребителей `.all`, поэтому мутация одним была бы видна остальным.
- **Агрегат не принадлежит модулю** (`metadata.module === undefined`), значит при
  `strictExports` его ребро на вклад модуля M требует, чтобы M вклад
  экспортировал. Семейство в `exports` (`exports: [IHealthCheck]`) закрывает это
  разом — явный контракт «модуль контрибьютит в семейство».
- **Токен зарезервирован**: провайдер с `provide: IHealthCheck.all` — ошибка
  регистрации, как и членский параметр `'{all}'`.

## `strictExports` — проверка видимости на сборке

Видимость в Nestling решают ES-модули; `exports` модуля — метаданные. Если нужно,
чтобы декларации проверялись, включается opt-in lint:

```typescript
const container = await new ContainerBuilder({ strictExports: true })
  .register(LoggingModule)
  .register(AppModule)
  .build();
```

`build()` обходит готовый граф и для каждого ребра `потребитель → зависимость`,
где зависимость принадлежит модулю M, а потребитель — нет, требует токен
зависимости в `exports` модуля M. Рёбра внутри модуля и зависимости без модуля
свободны; отсутствующий `exports` означает «не экспортировано ничего»; все
нарушения приходят одной ошибкой списком `потребитель → зависимость (модуль)`.

Семейство в `exports` (`exports: [ILogger]`) экспортирует всех своих
материализованных членов — иначе пришлось бы перечислять скоупы руками, а они
как раз и появляются на сборке.

Флаг выключен по умолчанию: включение — осознанный шаг после того, как модули
объявили exports честно.

## Чего в v1 нет

- Многопараметрических семейств (`IQueue('orders', 'dlq')`) — параметр ровно один.
- Валидации параметра (enum допустимых скоупов) — оберните семейство своей
  функцией, если нужно.
- Материализации члена без потребителя (seed-списка) — единственный источник
  членов это deps; `.all` этого правила не меняет.
- Явных весов и приоритетов вкладов в `.all` — порядок только регистрационный.
- Агрегатов-подмножеств (`.all` с фильтром), форм `[param, T][]` / `Map` и
  подмены состава агрегата в тестах — см. [roadmap](../decisions/roadmap.md).

Целевое состояние подсистемы — [design/container.md](../design/container.md);
логика решений — [decisions/ideas.md](../decisions/ideas.md), запись
«[2026-07-06] Token families + модули без рантайм-инкапсуляции».
