# @nestling/openapi.zod

Конвертер схем zod в JSON Schema — десять строк поверх штатного
`z.toJSONSchema()`.

> 🚧 Active development, API may change. Design:
> [`docs/design/schemas.md`](../../docs/design/schemas.md) §2.
> Guide: [`docs/guides/openapi.md`](../../docs/guides/openapi.md).

```typescript
import { openapi } from '@nestling/openapi';
import { zodConverter } from '@nestling/openapi.zod';

openapi({ info, converters: [zodConverter()] });
```

## Почему отдельный пакет

Конвертер — единственное место, знающее устройство конкретного валидатора.
Он живёт отдельно, потому что его мажоры следуют за мажорами **валидатора**,
а не фреймворка: `zod` здесь peer-зависимость, и пользователь ставит ровно
то, чем пользуется.

Вшитого реестра «вендор → конвертер» в `@nestling/openapi` нет: список
конвертеров это данные вызывающего, и даже в стопроцентно-zod приложении
конвертер называется явно одной строкой. Цена explicit over implicit
посчитана в [журнале решений](../../docs/decisions/ideas.md) и принята.

## Направление конвертации

Схема с преобразованием (`z.string().transform(Number)`, `z.stringbool()`)
описывает **две** формы: то, что приходит по проводу, и то, что получает
хендлер. Направление выбирает вызывающий — генератор передаёт `io: 'input'`
для тела запроса и `io: 'output'` для тела ответа; конвертер его только
пробрасывает. Без подсказки поведение штатное — то же, что у голого
`z.toJSONSchema()`.

Прочие опции `z.toJSONSchema` принимаются аргументом:

```typescript
zodConverter({ unrepresentable: 'any' });
```
