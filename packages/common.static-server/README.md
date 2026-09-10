# @nestlingjs/common.static-server

Сервер статических файлов на `node:http` без внешних зависимостей: отдаёт
каталог по HTTP, подставляет MIME-тип по расширению и закрывается по
сигналу. Им пользуется `@nestlingjs/viz`, чтобы отдавать фронтенд
визуализации.

> Внутренний пакет Nestling: приходит зависимостью `@nestlingjs/viz`, отдельно ставить его незачем.

## Установка

Пакет внутренний и приходит зависимостью `@nestlingjs/viz`. Отдельно
устанавливать его не нужно.

## Минимальный пример

```typescript
import { StaticServer } from '@nestlingjs/common.static-server';

const server = new StaticServer({
  port: 3333,
  staticDir: new URL('./public', import.meta.url).pathname,
  disableCache: true,
});

await server.start();
```

## Экспорты

| Имя | Что делает |
|---|---|
| `StaticServer` | отдаёт файлы каталога по HTTP; `start()` и `stop()` |
| `StaticServerOptions` | порт, каталог, заголовки, файл по умолчанию, таймаут остановки |

## Границы пакета

Сервер отдаёт файлы с диска. Маршрутизации, шаблонов, сжатия и HTTPS у него
нет: приложение на Nestling обслуживает `@nestlingjs/transport.http`.
