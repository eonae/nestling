# Simple CLI Example

Простой пример использования `@nestling/transport` для создания CLI приложения.

## Возможности

- ✅ Middleware для логирования команд
- ✅ Несколько команд с разной логикой
- ✅ Обработка аргументов и опций
- ✅ Справка по командам
- ✅ Обработка ошибок

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
Поприветствовать кого-то

```bash
yarn dev greet Alice
yarn dev greet Bob --enthusiastic
```

### info
Показать системную информацию

```bash
yarn dev info
```

### calc <a> <b> --op <operation>
Выполнить математическую операцию

Доступные операции: `add`, `sub`, `mul`, `div` (или `+`, `-`, `*`, `/`)

```bash
yarn dev calc 10 5 --op add
yarn dev calc 10 5 --op +
yarn dev calc 20 4 --op div
```

### echo <text> [--uppercase]
Повторить текст

```bash
yarn dev echo "Hello World"
yarn dev echo "Hello World" --uppercase
```

## Примеры

```bash
# Приветствие
yarn dev greet

# Приветствие с именем
yarn dev greet Sergey

# Восторженное приветствие
yarn dev greet Sergey --enthusiastic

# Системная информация
yarn dev info

# Калькулятор
yarn dev calc 15 3 --op mul
yarn dev calc 100 25 --op div

# Эхо
yarn dev echo "Testing CLI transport"
yarn dev echo "loud message" --uppercase
```

## Архитектура

Пример демонстрирует:

1. **Middleware** - логирование команд с измерением времени выполнения
2. **Command routing** - регистрация обработчиков команд
3. **Argument parsing** - простой парсер аргументов командной строки
4. **Error handling** - обработка неизвестных команд и ошибок
5. **Exit codes** - правильные коды выхода для успеха/ошибки

Весь код находится в `src/main.ts` для простоты понимания.

