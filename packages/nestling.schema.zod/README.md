# @nestlingjs/schema.zod

Конвертер схем zod в JSON Schema: обёртка над штатным `z.toJSONSchema()`.
JSON Schema читают генератор OpenAPI, структурная проверка контрактов и
вопросы CLI-транспорта. Конвертер указывается явно даже в приложении целиком
на zod: реестра «вендор — конвертер» у потребителей нет.

> 🚧 Активная разработка, API может меняться.
> Дизайн: [`docs/design/schemas.md`](../../docs/design/schemas.md) §2.
> Гайд: [глава 13. Отдать фронтенду документацию и клиент](../../docs/guide/13-openapi-and-client.md).

## Установка

```bash
npm install @nestlingjs/schema.zod zod
```

`zod` — peer-зависимость: ставится та версия, которой пользуется приложение.

## Минимальный пример

```typescript
import { openapi } from '@nestlingjs/openapi';
import { zodConverter } from '@nestlingjs/schema.zod';

openapi({
  info: { title: 'users', version: '1.0.0' },
  converters: [zodConverter({ unrepresentable: 'any' })],
});
```

Тот же конвертер принимает CLI-транспорт — командам с политикой
`missing: 'prompt'` он даёт формы полей для вопросов:

```typescript
import { cli } from '@nestlingjs/transport.cli';
import { zodConverter } from '@nestlingjs/schema.zod';

cli({ converters: [zodConverter()] });
```

## Экспорты

| Имя | Что делает |
|---|---|
| `zodConverter` | возвращает `SchemaDocConverter` с `vendor: 'zod'` |
| `ZodConverterOptions` | опции `z.toJSONSchema` без `io` |

Схема с преобразованием (`z.string().transform(Number)`, `z.stringbool()`)
описывает две формы: ту, что приходит в запросе, и ту, что получает хендлер.
Какую описать, выбирает вызывающий: генератор OpenAPI передаёт `io: 'input'`
для тела запроса и `io: 'output'` для тела ответа. Схему параметра пути или
query он берёт из формы `io: 'output'`, когда та скалярная, а форма
`io: 'input'` строковая. CLI-транспорт берёт форму `io: 'input'`: вход
команды приходит строками из argv.

## Границы пакета

Пакет конвертирует только схемы zod. Для другого валидатора нужен свой
конвертер.
