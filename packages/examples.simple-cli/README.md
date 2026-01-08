# Simple CLI Example

Простой пример использования `@nestling/transport.cli` напрямую, без `@nestling/app`.

## Возможности

- ✅ Прямая работа с `CliTransport`
- ✅ Middleware для логирования команд
- ✅ Функциональный стиль создания эндпоинтов (`makeEndpoint`)
- ✅ Обработка аргументов и опций
- ✅ Справка по командам
- ✅ Обработка потоковых данных из stdin
- ✅ Обработка ошибок
- ✅ REPL режим и single-shot режим

## Запуск

### Development режим

```bash
cd packages/examples.simple-cli
yarn dev [command] [args] [options]
```

### Production режим

```bash
cd packages/examples.simple-cli
yarn start [command] [args] [options]
```

Или из корня проекта:

```bash
yarn workspace examples.simple-cli dev [command] [args]
```

## Доступные команды

### help
Показать справку

```bash
yarn dev help
```

### process-stdin
Обработать потоковые данные из stdin

```bash
echo "line1\nline2\nline3" | yarn dev process-stdin
```

## Примеры

```bash
# Справка
yarn dev help

# Обработка потоковых данных
echo "line1\nline2\nline3" | yarn dev process-stdin

# REPL режим (без аргументов)
yarn dev
> help
> process-stdin
> exit
```

## Архитектура

Пример демонстрирует прямую работу с `CliTransport` без использования `@nestling/app`.

### Функциональный стиль (`makeEndpoint`)

Все эндпоинты создаются через `makeEndpoint`:

- `help` - справка по командам
- `process-stdin` - обработка потоковых данных

**Преимущества:**
- Простота и читаемость
- Минимум кода
- Типы выводятся автоматически из схем
- Не требует дополнительной инфраструктуры

**Пример:**

```typescript
import { makeEndpoint } from '@nestling/pipeline';

export const Help = makeEndpoint({
  transport: 'cli',
  pattern: 'help',
  output: HelpResponseSchema,
  handle: async () => {
    // Типы выводятся автоматически!
    return { status: 'OK', value: {...} };
  },
});
```

### Регистрация эндпоинтов

Эндпоинты регистрируются напрямую в транспорте:

```typescript
import { CliTransport } from '@nestling/transport.cli';
import { Help, ProcessStdin } from './endpoints.functional';

const cliTransport = new CliTransport();

// Регистрируем эндпоинты
cliTransport.endpoint(Help);
cliTransport.endpoint(ProcessStdin);

// Запускаем транспорт
await cliTransport.listen();
```

### Middleware

Пример демонстрирует два стиля middleware:

1. **Функциональный стиль** (`LoggingMiddleware`) - простая функция
2. **Классовый стиль** (`TimingMiddleware`) - класс с методом `process()`

Middleware добавляются напрямую в транспорт:

```typescript
cliTransport.use(LoggingMiddleware);
cliTransport.use(TimingMiddleware);
```

### Структура проекта

```
src/
├── endpoints.functional/    # Функциональные эндпоинты
│   ├── index.ts
│   ├── help.endpoint.ts
│   └── process-stdin.endpoint.ts
├── middleware/              # Middleware
│   ├── index.ts
│   ├── logging.middleware.ts
│   └── timing.middleware.ts
└── main.ts                  # Entry point
```

## Дополнительные возможности

1. **Прямая работа с транспортом** - без дополнительного слоя абстракции `App`
2. **Middleware** - логирование команд с измерением времени выполнения
3. **Command routing** - встроенный роутинг команд в `CliTransport`
4. **Argument parsing** - встроенный парсер аргументов
5. **Error handling** - обработка неизвестных команд и ошибок
6. **Exit codes** - правильные коды выхода для успеха/ошибки
7. **REPL режим** - интерактивный режим при запуске без аргументов
8. **Stream processing** - обработка потоковых данных из stdin

## См. также

Для примеров с классовыми эндпоинтами и использованием `@nestling/app` см.:
- `@examples.app-with-http` - полноценное приложение с HTTP транспортом и классовыми эндпоинтами
