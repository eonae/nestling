# @nestlingjs/logging.pino

pino под интерфейсом `Logger`: redaction, сериализаторы и семплирование
библиотеки при формате строки, общем со штатным логгером Nestling. Записи
уходят в `stderr` одной строкой каждая.

> 🚧 Активная разработка, API может меняться.
> Дизайн: [`docs/design/composition.md`](../../docs/design/composition.md),
> раздел «Логгер».
> Гайд: [глава 9. Видеть каждый запрос в логе](../../docs/guide/09-logging.md).

## Установка

```bash
npm install @nestlingjs/logging.pino pino
```

`pino` — peer-зависимость: версию библиотеки выбирает приложение, и второй
копии pino в дереве быть не должно. Диапазон один мажор — `^10.0.0`:
redaction, сериализаторы и плагины экосистемы живут вокруг него.

## Минимальный пример

```typescript
import { makeApp } from '@nestlingjs/app';
import { pinoLogger } from '@nestlingjs/logging.pino';

export const app = makeApp({
  features: [UsersFeature],
  transports: [http()],
  logging: {
    logger: pinoLogger({
      format: 'json',
      pino: { redact: ['password'] },
    }),
  },
});
```

Поля корреляции ставит ядро: `requestId` и `traceId` приходят в записи
сами, адаптеру о них знать не нужно. Тот же вызов берёт и скрипт вне
приложения — миграция, генератор документа, standalone-диспетчер.

## Экспорты

| Имя | Что это |
| --- | --- |
| `pinoLogger` | логгер поверх pino; умолчания `info` и `text` |
| `PinoLoggerOptions` | опции: `level`, `format` и `pino` |

Порог `level` принимает четыре уровня интерфейса, `silent` и два уровня
pino: `trace` отображается на `debug`, `fatal` — на `error`. Формат
`format` — `text` или `json`. Поле `pino` передаёт библиотеке остальное.

Ключи `level`, `timestamp`, `formatters`, `base`, `messageKey`,
`errorKey`, `transport` и вложенный `serializers.err` заняты адаптером:
ими держится формат записи. Занятый ключ в поле `pino` — отказ с именем
ключа и заменой.

## Границы пакета

Зависимость у пакета одна — `@nestlingjs/logging`: адаптеру нужен
интерфейс, а не композиционный корень. Формат `text` печатает `formatLine`
оттуда же, поэтому строка совпадает со штатным логгером до байта. Формат
`json` пишет сам pino: набор ключей тот же, порядок — его.

`pino-pretty`, `pino.transport`, multistream, файлы и ротация в пакет не
входят. Записи уходят в `stderr` одним синхронным писателем: воркер-поток
не собирается одним бандлом и теряет строки на аварийном выходе. Собирает
вывод процесса тот, кто его запускает.
