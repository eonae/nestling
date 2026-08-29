# @nestling/openapi.zod

Конвертер схем zod в JSON Schema для `@nestling/openapi`: обёртка над
штатным `z.toJSONSchema()`.

> 🚧 Активная разработка, API может меняться.
> Дизайн: [`docs/design/schemas.md`](../../docs/design/schemas.md) §2.
> Гайд: [`docs/guides/openapi.md`](../../docs/guides/openapi.md).

## Установка

```bash
npm install @nestling/openapi.zod zod
```

`zod` — peer-зависимость: установите ту версию, которой пользуетесь.

## Использование

```typescript
import { openapi } from '@nestling/openapi';
import { zodConverter } from '@nestling/openapi.zod';

openapi({ info, converters: [zodConverter()] });
```

Конвертер указывается явно даже в приложении целиком на zod: встроенного
реестра «вендор → конвертер» в `@nestling/openapi` нет.

## Направление конвертации

Схема с преобразованием (`z.string().transform(Number)`,
`z.stringbool()`) описывает две формы: ту, что приходит в запросе, и ту,
что получает хендлер. Какую из них описать, выбирает вызывающий:
генератор передаёт `io: 'input'` для тела запроса и `io: 'output'` для
тела ответа, а конвертер передаёт подсказку в `z.toJSONSchema()`. Без
подсказки результат совпадает с обычным `z.toJSONSchema()`.

## Опции

Остальные опции `z.toJSONSchema` (`unrepresentable`, `cycles`, `reused` и
другие) передаются аргументом:

```typescript
zodConverter({ unrepresentable: 'any' });
```

## Справочник

| Имя | Что это |
|---|---|
| `zodConverter(options?)` | возвращает `SchemaDocConverter` с `vendor: 'zod'` |
| `ZodConverterOptions` | опции `z.toJSONSchema` без `io` |

## Границы пакета

Пакет конвертирует только схемы zod; для другого валидатора нужен свой
конвертер.
