# @nestlingjs/openapi.zod

Конвертер схем zod в JSON Schema для `@nestlingjs/openapi`: обёртка над штатным
`z.toJSONSchema()`. Конвертер указывается явно даже в приложении целиком на
zod: реестра «вендор — конвертер» в генераторе нет.

> 🚧 Активная разработка, API может меняться.
> Дизайн: [`docs/design/schemas.md`](../../docs/design/schemas.md) §2.
> Гайд: [глава 12. Отдать фронтенду документацию и клиент](../../docs/guide/12-openapi-and-client.md).

## Установка

```bash
npm install @nestlingjs/openapi.zod zod
```

`zod` — peer-зависимость: ставится та версия, которой пользуется приложение.

## Минимальный пример

```typescript
import { openapi } from '@nestlingjs/openapi';
import { zodConverter } from '@nestlingjs/openapi.zod';

openapi({
  info: { title: 'users', version: '1.0.0' },
  converters: [zodConverter({ unrepresentable: 'any' })],
});
```

## Экспорты

| Имя | Что делает |
|---|---|
| `zodConverter` | возвращает `SchemaDocConverter` с `vendor: 'zod'` |
| `ZodConverterOptions` | опции `z.toJSONSchema` без `io` |

Схема с преобразованием (`z.string().transform(Number)`, `z.stringbool()`)
описывает две формы: ту, что приходит в запросе, и ту, что получает хендлер.
Какую описать, выбирает вызывающий: генератор передаёт `io: 'input'` для тела
запроса и `io: 'output'` для тела ответа.

## Границы пакета

Пакет конвертирует только схемы zod. Для другого валидатора нужен свой
конвертер.
