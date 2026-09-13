# @nestlingjs/testing

декларацию `makeApp`, что запускает `main.ts`, и проводит приложение по
фазам `0 BOOTSTRAP`, `1 BUILD`, `2 INIT`, `3 WIRE`: `dispatch` создан,
сокеты не открыты, обработчики сигналов не установлены, в stdout ничего не
напечатано. Прогон молчит: уровень логгера — `silent`, пока тест не
задаст свой через `config:` или не подменит `[RootLogger$, spy.logger]`.
`testApp.run()` продолжает до `4 START` и `5 RUN` — сокет открывается, а
`testApp.baseUrl(name?)` отдаёт его адрес.

> 🚧 Активная разработка, API может меняться. Раннера, матчеров и
> snapshot-механики пакет не вводит: jest остаётся jest'ом.
> Дизайн: [`docs/design/testing.md`](../../docs/design/testing.md).
> Гайд: [глава 8. Убедиться, что работает, без запуска сервера](../../docs/guide/08-testing.md),
> [глава 22. Считать запросы и вызовы](../../docs/guide/22-metrics.md).

## Установка

```bash
npm install --save-dev @nestlingjs/testing
```

Тест-раннер обязан включать условие резолва `testing`. Тестовые
поверхности пакетов объявлены subpath'ами под этим условием, поэтому без
него импорт падает на резолве с `ERR_PACKAGE_PATH_NOT_EXPORTED`: граница
между тестовым и боевым кодом структурная, а не по договорённости.

```javascript
// jest.config.js
export default {
  testEnvironmentOptions: {
    customExportConditions: ['testing', 'node', 'node-addons'],
  },
};
```

Node включает условие флагом `--conditions=testing`.

## Минимальный пример

```typescript
import { app } from './app'; // та же декларация makeApp, что у main.ts

import { bind } from '@nestlingjs/app';
import { buildTest, stub, unwrap, vars } from '@nestlingjs/testing';

await using testApp = await buildTest(app, {
  overrides: [[UsersRepository, inMemoryUsersRepo()]],
  // заглушка операции, которую эта сборка не реализует
  stubs: [stub(ChargeCard, async ({ amount }) => ({ chargeId: `c-${amount}` }))],
  config: [bind(vars({ USERS_PAGE_SIZE: '10' }))],
});

const user = unwrap(await testApp.call(GetUser, { id: '1' }));

expect(user).toEqual({ id: '1', name: 'Alice' });
```

## Экспорты

- **Сборка** — `buildTest`, `TestApp`, `TestBuildOptions`,
  `TestCallOptions`, `EmitDelivery`, `UnwrapFailedError`, `unwrap`.
- **Подстановки** — `TestOverride`, `TestStub`, `stub`, `OperationStub`,
  `RequestStubImpl`, `EmitStubImpl`, `StubOutput`, `familyOverride`,
  `contextValue`, `vars`, `ObjectSource`.
- **Логгер и метрики** — `spyLogger`, `SpyLogger`, `LogEntry`, `spyMetrics`,
  `SpyMetrics`, `MetricRecord`.
- **Топологии и единицы** — `checkTopologies`, `TopologyReport`,
  `testBundle`, `TestBundleOptions`.
- **Реэкспорт [`@nestlingjs/app`](../nestling.app/)** — имена ядра, чтобы тест
  импортировал один пакет.

`vars(record)` — собственная реализация `ConfigSource` пакета, а не
обёртка над ядром: объект вместо `process.env`, с `set`/`assign` для
reloadable-секций. Ключи привязки заменяют привязки декларации целиком —
у декларации их нет вовсе, поэтому тест изолирован и от `process.env`, и
от любых умолчаний.

Список `transports` в опциях не принимается: состав, включая транспорты,
берётся из декларации `makeApp`. Без `testApp.run()` сокеты не
открываются; после него `testApp.baseUrl(name?)` отдаёт адрес сервера —
без имени, если объявлен один, по имени, если несколько.

## Границы пакета

Пакет собирает приложение и даёт к нему доступ. Он не запускает транспорты,
не поднимает базу и не заменяет раннер тестов.
