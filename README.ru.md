# Nestling

> Лёгкая, opinionated замена Nest.js с ECMAScript-декораторами и без магии

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

## ⚠️ Активная разработка

**Nestling** находится в активной разработке. Проект развивается, API могут меняться. Используйте в production на свой риск.

## Что такое Nestling?

Nestling - это моя персональная версия Nest.js, фреймворка, который одновременно любят и ненавидят. Он берёт то, что команды реально используют из Nest.js, оставляя за бортом ненужную сложность.

Если Nest.js позиционирует себя как opinionated решение, то **Nestling ещё более opinionated**.

## Текущий статус

На данный момент в Nestling входят:

### ✅ @nestling/container

Полностью рабочий типобезопасный DI-контейнер без сторонних зависимостей.

**Ключевые возможности:**
- 🎯 Типобезопасность с отличным выводом типов в TypeScript
- 🪶 Лёгкий, без сторонних зависимостей
- 🎪 Использует стандартные ECMAScript-декораторы (не экспериментальные TypeScript)
- 🔍 Прозрачный граф зависимостей с поддержкой визуализации
- 🎯 Циклические зависимости запрещены (по дизайну)
- 📦 Можно использовать отдельно - на фронтенде, в CLI, с любым фреймворком

👉 **[Читать полную документацию](./packages/nestling.container/README.ru.md)** | **[English version](./packages/nestling.container/README.md)**

### 🚧 HTTP/CLI-фреймворк (активная разработка, API меняются)

- **@nestling/pipeline** — типизированный транспорт-агностичный пайплайн: schema-first endpoints (zod), типизированные цепочки middleware, результаты `Ok`/`Fail`, стриминг
- **@nestling/app** — сборка приложения: контейнер + транспорты, авто-обнаружение endpoints, lifecycle, graceful shutdown
- **@nestling/transport.http** — HTTP-транспорт на голом `node:http` (роутинг, JSON/multipart/NDJSON)
- **@nestling/transport.cli** — CLI-транспорт: команды как endpoints, single-shot и REPL
- **@nestling/models** — типобезопасные определения моделей поверх zod

Целевой дизайн развивается в [`docs/decisions/`](./docs/decisions/ideas.md); гайды — в [`docs/guides/`](./docs/README.md).

### 📊 @nestling/viz

Инструмент интерактивной визуализации графа зависимостей.

**Возможности:**
- 🎨 Красивая интерактивная визуализация графа
- 🔍 Исследуйте зависимости визуально
- 🌳 Понимайте структуру приложения с одного взгляда
- 🎯 Выявляйте потенциальные проблемы в дереве зависимостей

Сгенерируйте визуализацию графа зависимостей вашего контейнера и исследуйте её в браузере.

### 📚 Примеры

- [simple-app](./packages/examples.simple-app/) — standalone DI: модули, factory-провайдеры, параметризованные токены, lifecycle-хуки
- [simple-http-server](./packages/examples.simple-http-server/) — функциональные HTTP-endpoints ([гайд](./docs/guides/http-functional.md))
- [app-with-http](./packages/examples.app-with-http/) — полный App с DI и классовыми endpoints ([гайд](./docs/guides/http-app-di.md))
- [simple-cli](./packages/examples.simple-cli/) — CLI-транспорт ([гайд](./docs/guides/cli.md))

## Установка

```bash
npm install @nestling/container
```

## Быстрый старт

```typescript
import { Injectable, makeModule, ContainerBuilder } from '@nestling/container';

// Определяем сервис
@Injectable([])
class UserService {
  getUsers() {
    return ['Алиса', 'Боб'];
  }
}

// Создаём модуль
const appModule = makeModule({
  name: 'AppModule',
  providers: [UserService],
  exports: [UserService]
});

// Собираем и используем контейнер
const container = await new ContainerBuilder()
  .register(appModule)
  .build();

await container.init();

const userService = container.getOrThrow(UserService);
console.log(userService.getUsers()); // ['Алиса', 'Боб']

await container.destroy();
```

## Почему Nestling?

### Чем отличается от Nest.js?

**Убрано:**
- ❌ `ForwardRef` - циклических зависимостей не должно быть никогда
- ❌ `REQUEST` и `TRANSIENT` скоупы - лучше обрабатывать на уровне приложения
- ❌ Модули как классы - это просто конфигурация, не нужны церемонии

**Улучшено:**
- ✅ Модули - простые объекты (проще, чище)
- ✅ Lifecycle-хуки в строгом топологическом порядке
- ✅ Полный доступ к графу зависимостей
- ✅ Стандартные JavaScript-декораторы
- ✅ Без сторонних зависимостей для лучшей безопасности
- ✅ Явное лучше неявного везде

**[Подробнее о философии →](./packages/nestling.container/README.ru.md#чем-отличается-di-nestling-и-что-у-него-общего-с-nest-контейнером)**

## Roadmap

- [x] DI-контейнер (`@nestling/container`)
- [x] Визуализация графа зависимостей (`@nestling/viz`)
- [x] Типизированный пайплайн (`@nestling/pipeline`) — развивается, см. [docs/decisions](./docs/decisions/ideas.md)
- [x] HTTP-транспорт (`@nestling/transport.http`) — работает, production-hardening впереди
- [x] CLI-транспорт (`@nestling/transport.cli`)
- [x] Сборка приложения (`@nestling/app`)
- [ ] Pipeline v2: фазы, слои, `compose` ([решения](./docs/decisions/ideas.md))
- [ ] Token families и модули-фабрики
- [ ] Request-контекст с AsyncLocalStorage (`@nestling/context`)
- [ ] Реестр подписок (`@nestling/subscriptions`)
- [ ] CLI-инструмент для scaffolding
- [ ] Утилиты для тестирования

## Документация

Вся документация лежит в [`docs/`](./docs/README.md) и организована по статусу:

- [`docs/design/`](./docs/README.md) — целевой дизайн (источник истины для API)
- [`docs/decisions/`](./docs/decisions/ideas.md) — журнал архитектурных решений с логикой принятия
- `docs/history/` — замороженные дискуссии, миграции и рабочие заметки

Актуальное состояние кода документируют README пакетов.

## Структура проекта

Это монорепозиторий, содержащий:

```
docs/                          # Дизайн-доки, решения, гайды, история
packages/
├── nestling.container/        # Ядро DI-контейнера
├── nestling.pipeline/         # Типизированный пайплайн и endpoints
├── nestling.app/              # Сборка приложения и lifecycle
├── nestling.transport/        # Абстракция транспорта
├── nestling.transport.http/   # HTTP-транспорт
├── nestling.transport.cli/    # CLI-транспорт
├── nestling.models/           # Модели поверх zod
├── nestling.viz/              # Визуализация графа зависимостей
├── examples.simple-app/       # Пример: standalone DI
├── examples.simple-http-server/  # Пример: функциональный HTTP
├── examples.app-with-http/    # Пример: App + DI + HTTP
├── examples.simple-cli/       # Пример: CLI-транспорт
├── common.graphs/             # Внутреннее: утилиты DAG
├── common.misc/               # Внутреннее: общие хелперы
└── common.static-server/      # Внутреннее: статик-сервер (для viz)
```

## Contributing

Это персональный проект, но предложения и обсуждения приветствуются! Не стесняйтесь открывать issue с идеями или вопросами.

## Лицензия

MIT © 2025

---

**Примечание:** О пути, который привёл к созданию ещё одного JavaScript-фреймворка, будет написано отдельно. Но короткая версия: явное лучше неявного, а простота - это фича.

