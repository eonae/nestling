# @nestlingjs/testing

Тестовый composition root. `assembleTest(app, options)` собирает ту же
декларацию `makeApp`, что запускает `main.ts`, проводит приложение по фазам
`0 BOOTSTRAP`, `1 ASSEMBLE`, `2 INIT`, `3 WIRE` и останавливается: `dispatch`
создан, сокеты не открыты, обработчики сигналов не установлены, в stdout
ничего не напечатано.

> 🚧 Активная разработка, API может меняться. Раннера, матчеров и
> snapshot-механики пакет не вводит: jest остаётся jest'ом.
> Дизайн: [`docs/design/testing.md`](../../docs/design/testing.md).
> Гайд: [глава 8. Убедиться, что работает, без запуска сервера](../../docs/guide/08-testing.md).

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

import { assembleTest, stub, unwrap, vars } from '@nestlingjs/testing';

await using testApp = await assembleTest(app, {
  overrides: [[UsersRepository, inMemoryUsersRepo()]],
  // заглушка операции, которую эта сборка не реализует
  stubs: [stub(ChargeCard, async ({ amount }) => ({ chargeId: `c-${amount}` }))],
  config: vars({ USERS_PAGE_SIZE: '10' }),
});

const user = unwrap(await testApp.call(GetUser, { id: '1' }));

expect(user).toEqual({ id: '1', name: 'Alice' });
```

## Экспорты

- **Сборка** — `assembleTest`, `TestApp`, `TestAssemblyOptions`,
  `TestCallOptions`, `EmitDelivery`, `UnwrapFailedError`, `unwrap`.
- **Подстановки** — `TestOverride`, `TestStub`, `stub`, `OperationStub`,
  `RequestStubImpl`, `EmitStubImpl`, `StubOutput`, `familyOverride`,
  `contextValue`, `vars`.
- **Логгер** — `spyLogger`, `SpyLogger`, `LogEntry`.
- **Топологии и юниты** — `checkTopologies`, `TopologyReport`, `testUnit`,
  `TestUnitOptions`.
- **Реэкспорт [`@nestlingjs/app`](../nestling.app/)** — имена ядра, чтобы тест
  импортировал один пакет.

Список `transports` в опциях не принимается: тестовая сборка не выполняет
START, поэтому сокеты не открываются и подменять порт незачем.

## Границы пакета

Пакет собирает приложение и даёт к нему доступ. Он не запускает транспорты,
не поднимает базу и не заменяет раннер тестов.
