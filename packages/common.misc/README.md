# @nestlingjs/common.misc

Схемный кернел Nestling и общие вспомогательные типы. Пакет задаёт словарь
схем поверх [Standard Schema v1](https://standardschema.dev) и держит
единственное место, где ядро проверяет данные схемой, — `validateSync`.
Через него проходят разбор входа пайплайном, поэлементная проверка потоков
и поля секций конфигурации, поэтому ошибка валидации везде выглядит
одинаково.

> Внутренний пакет Nestling: ставится вместе с ядром, часть его имён реэкспортирует `@nestlingjs/app`.

## Установка

Пакет внутренний и приходит зависимостью ядра. Отдельно устанавливать его не
нужно: перечисленные имена доступны из `@nestlingjs/app`.

## Минимальный пример

```typescript
import { SchemaValidationError, validateSync } from '@nestlingjs/common.misc';
import { z } from 'zod';

const schema = z.object({ id: z.string() });

try {
  const value = validateSync(schema, { id: 42 }, 'bad payload');
  console.log(value.id);
} catch (error) {
  // issues уже нормализованы: путь развёрнут, символы приведены к строкам.
  if (error instanceof SchemaValidationError) console.log(error.issues);
}
```

## Экспорты

| Имя | Что делает |
|---|---|
| `Schema` | псевдоним `StandardSchemaV1`: подходит любой валидатор спецификации |
| `Infer` | выходной тип схемы, либо `undefined`, если схемы нет |
| `DomainType` | выходной тип схемы, которая задана всегда |
| `SchemaIssue` | одна претензия валидатора после нормализации |
| `validateSync` | проверяет значение схемой и возвращает разобранное |
| `assertStandardSchema` | проверяет, что значение реализует спецификацию |
| `normalizeIssues` | нормализует `issues` собственного кода так же, как ядро |
| `SchemaValidationError` | значение не прошло схему; несёт `issues` |
| `AsyncSchemaNotSupportedError` | схема вернула промис: асинхронная проверка не поддержана |
| `NotAStandardSchemaError` | у объекта нет `~standard` с `version: 1` |
| `Constructor` | конструктор класса как значение |
| `Optional` | `T` либо `undefined` |
| Реэкспорт `@standard-schema/spec` | `StandardSchemaV1`, чтобы не ставить пакет спецификации |

## Границы пакета

Ядро не заглядывает внутрь схемы: спецификация даёт только валидацию и вывод
типов. Разбор схемы в JSON Schema делают конвертеры `@nestlingjs/openapi`.
