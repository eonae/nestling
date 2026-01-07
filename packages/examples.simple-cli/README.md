# Simple CLI Example

Простой пример использования `@nestling/transport` для создания CLI приложения.

## Возможности

- ✅ Middleware для логирования команд
- ✅ Несколько команд с разной логикой
- ✅ Обработка аргументов и опций
- ✅ Справка по командам
- ✅ Обработка ошибок
- ✅ Два подхода к регистрации handler'ов (функциональный и классовый)
- ✅ Декораторы для типобезопасной регистрации

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

### greet [name] [--enthusiastic]
Поприветствовать кого-то (функциональный стиль)

```bash
yarn dev greet Alice
yarn dev greet Bob --enthusiastic
```

### greet-schema [name] [--enthusiastic]
Поприветствовать кого-то со схемой валидации (классовый стиль с декоратором)

```bash
yarn dev greet-schema Alice
yarn dev greet-schema Bob --enthusiastic
```

### info
Показать системную информацию (классовый стиль с декоратором)

```bash
yarn dev info
```

### calc <a> <b> --op <operation>
Выполнить математическую операцию (функциональный стиль)

Доступные операции: `add`, `sub`, `mul`, `div` (или `+`, `-`, `*`, `/`)

```bash
yarn dev calc 10 5 --op add
yarn dev calc 10 5 --op +
yarn dev calc 20 4 --op div
```

### calc-schema <a> <b> --op <operation>
Выполнить математическую операцию со схемой валидации (классовый стиль с декоратором)

Доступные операции: `add`, `sub`, `mul`, `div` (или `+`, `-`, `*`, `/`)

```bash
yarn dev calc-schema 10 5 --op add
yarn dev calc-schema 10 5 --op +
yarn dev calc-schema 20 4 --op div
```

### echo <text> [--uppercase]
Повторить текст (функциональный стиль)

```bash
yarn dev echo "Hello World"
yarn dev echo "Hello World" --uppercase
```

## Примеры

```bash
# Приветствие (функциональный стиль)
yarn dev greet

# Приветствие с именем
yarn dev greet Sergey

# Восторженное приветствие
yarn dev greet Sergey --enthusiastic

# Приветствие со схемой (классовый стиль)
yarn dev greet-schema Sergey --enthusiastic

# Системная информация (классовый стиль)
yarn dev info

# Калькулятор (функциональный стиль)
yarn dev calc 15 3 --op mul
yarn dev calc 100 25 --op div

# Калькулятор со схемой (классовый стиль)
yarn dev calc-schema 15 3 --op mul

# Эхо
yarn dev echo "Testing CLI transport"
yarn dev echo "loud message" --uppercase
```

## Архитектура

Пример демонстрирует два подхода к регистрации handler'ов:

### Подход 1: Функциональный стиль (`makeEndpoint`)

Используется для простых команд без сложной логики валидации:

- `greet` - приветствие
- `echo` - эхо аргументов
- `calc` - калькулятор без схемной валидации

**Преимущества:**
- Простота и читаемость
- Минимум кода для простых команд
- Типы выводятся автоматически из схем

**Пример:**

```typescript
import { makeEndpoint } from '@nestling/transport';

export const Greet = makeEndpoint({
  transport: 'cli',
  pattern: 'greet',
  responseSchema: GreetResponseSchema,
  handler: async (payload) => {
    // payload типизирован автоматически!
    return { status: 0, value: {...}, meta: {} };
  },
});
```

### Подход 2: Классовый стиль (`@Handler`)

Используется для команд со сложной логикой и валидацией:

- `info` - информация о системе
- `calc-schema` - калькулятор со схемой валидации
- `greet-schema` - приветствие со схемой валидации

**Преимущества:**
- TypeScript РЕАЛЬНО проверяет типы параметров `handle()`
- Типы выводятся АВТОМАТИЧЕСКИ из схем
- Нельзя ошибиться в типах - получишь ошибку компиляции!
- Изолированная логика handler'а в отдельном классе
- Один класс = одна команда (Single Responsibility)

**Пример:**

```typescript
import { Handler } from '@nestling/transport';

@Handler({
  transport: 'cli',
  pattern: 'info',
  responseSchema: InfoResponseSchema,
})
export class InfoHandler {
  async handle(): Promise<ResponseContext<InfoResponse>> {
    // Типы проверяются компилятором!
    return { status: 0, value: {...}, meta: {} };
  }
}
```

### Middleware

Пример демонстрирует два стиля middleware:

1. **Функциональный стиль** (`LoggingMiddleware`) - простая функция
2. **Классовый стиль** (`TimingMiddleware`) - класс с декоратором `@Middleware()`

### Структура проекта

```
src/
├── handlers.functional/     # Функциональный стиль (makeEndpoint)
│   ├── index.ts
│   ├── greet.handler.ts
│   ├── echo.handler.ts
│   └── calc.handler.ts
├── handlers.class/          # Классовый стиль (@Handler)
│   ├── index.ts
│   ├── info.handler.ts
│   ├── calc-schema.handler.ts
│   └── greet-schema.handler.ts
├── middleware/              # Middleware в отдельных файлах
│   ├── index.ts
│   ├── logging.middleware.ts
│   └── timing.middleware.ts
├── common/                  # Общие типы и схемы
│   ├── index.ts
│   └── schemas.ts
└── main.ts                  # Упрощенный entry point
```

## Когда использовать какой подход?

### Используйте функциональный стиль (`makeEndpoint`), когда:
- Команда простая и не требует сложной валидации
- Нужна быстрая разработка без создания классов
- Логика команды умещается в одну функцию

### Используйте классовый стиль (`@Handler`), когда:
- Нужна строгая типобезопасность на уровне компиляции
- Команда требует сложной валидации через схемы
- Хотите изолировать логику в отдельном классе
- Планируете расширять функциональность команды

## Дополнительные возможности

1. **Middleware** - логирование команд с измерением времени выполнения
2. **Command routing** - регистрация обработчиков команд
3. **Argument parsing** - простой парсер аргументов командной строки
4. **Error handling** - обработка неизвестных команд и ошибок
5. **Exit codes** - правильные коды выхода для успеха/ошибки
6. **REPL режим** - интерактивный режим при запуске без аргументов
