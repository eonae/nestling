# Бенчмарки

## `http-vs-fastify.ts`

Сравнивает `@nestling/transport.http` с Fastify на одинаковой паре
endpoint'ов: `GET /users/:id` с JSON-ответом и `POST /users` с телом,
проверенным одной и той же zod-схемой на обеих сторонах.

```bash
yarn nx run-many -t build      # скрипт берёт пакеты из dist
yarn bench:http
```

Числа — точка отсчёта, а не порог. Они зависят от машины замера, поэтому
бенчмарк не входит в `yarn verify`, не проверяется тестом и ничего не
блокирует. Результат последнего замера и его условия записаны в
[`docs/decisions/ideas.md`](../../docs/decisions/ideas.md), запись
[2026-09-04] «Граница `@nestling/transport.http`».

Длительность и нагрузку задают переменные окружения `BENCH_DURATION`
(секунды, по умолчанию 10) и `BENCH_CONNECTIONS` (по умолчанию 50).

На `GET` стороны неравны: Nestling проверяет path-параметр схемой, а
Fastify читает его без проверки. Декларация с path-параметром без `input`
в Nestling запрещена, поэтому убрать эту работу нельзя.
