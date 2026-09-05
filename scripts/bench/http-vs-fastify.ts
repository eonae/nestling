/**
 * Бенчмарк `@nestling/transport.http` относительно Fastify.
 *
 * Поднимает по одному серверу на фреймворк с одинаковой парой
 * endpoint'ов и прогоняет по ним autocannon. Числа — точка отсчёта, а не
 * порог сборки: они зависят от машины замера, поэтому скрипт живёт вне
 * `yarn verify` и запускается вручную (`yarn bench:http`).
 *
 * Пара endpoint'ов:
 * - `GET /users/:id` — JSON-ответ. Nestling проверяет path-параметр
 *   схемой: декларация с path-параметром без `input` запрещена. Fastify
 *   читает параметр без проверки.
 * - `POST /users` — тело проверяется одной и той же zod-схемой на обеих
 *   сторонах.
 *
 * Пакеты берутся из `dist`, поэтому перед запуском нужен `yarn verify`
 * или `yarn nx run-many -t build`.
 */

import { existsSync } from 'node:fs';
import { arch, cpus, platform, release } from 'node:os';

import autocannon from 'autocannon';
import Fastify from 'fastify';
import { z } from 'zod';

import { Ok } from '@nestling/pipeline';
import { makeDispatch } from '@nestling/transport';
import { httpEndpoint, HttpTransport } from '@nestling/transport.http';

const DIST = 'packages/nestling.transport.http/dist/index.js';

if (!existsSync(DIST)) {
  console.error(
    `Сборка пакета не найдена: ${DIST}\n` +
      'Соберите пакеты: yarn nx run-many -t build',
  );
  process.exit(1);
}

/** Длительность одного замера в секундах */
const DURATION = Number(process.env.BENCH_DURATION ?? 10);

/** Число одновременных соединений */
const CONNECTIONS = Number(process.env.BENCH_CONNECTIONS ?? 50);

const HOST = '127.0.0.1';

const NewUser = z.object({ name: z.string(), email: z.string() });
const User = z.object({ id: z.string(), name: z.string() });

/** Ответ обоих серверов на `GET`: одинаковое значение, одинаковый JSON */
const userOf = (id: string): { id: string; name: string } => ({
  id,
  name: `user-${id}`,
});

/** Ответ обоих серверов на `POST` */
const createdOf = (body: { name: string }): { id: string; name: string } => ({
  id: 'u-1',
  name: body.name,
});

async function startNestling(): Promise<{
  url: string;
  stop: () => Promise<void>;
}> {
  const GetUser = httpEndpoint({
    method: 'GET',
    path: '/users/:id',
    input: z.object({ id: z.string() }),
    output: User,
    handler: ({ id }) => new Ok(userOf(id)),
  });

  const CreateUser = httpEndpoint({
    method: 'POST',
    path: '/users',
    input: NewUser,
    output: User,
    handler: (body) => new Ok(createdOf(body)),
  });

  const transport = new HttpTransport({ port: 0, host: HOST });
  const controller = new AbortController();

  await transport.serve(
    makeDispatch([GetUser, CreateUser]),
    controller.signal,
  );

  const address = transport.address();
  if (!address) {
    throw new Error('HttpTransport did not report an address after serve()');
  }

  return {
    url: `http://${HOST}:${address.port}`,
    stop: () => transport.close(),
  };
}

async function startFastify(): Promise<{
  url: string;
  stop: () => Promise<void>;
}> {
  const app = Fastify({ logger: false });

  app.get<{ Params: { id: string } }>('/users/:id', (request) =>
    userOf(request.params.id),
  );

  app.post('/users', (request) => createdOf(NewUser.parse(request.body)));

  await app.listen({ port: 0, host: HOST });

  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  return { url: `http://${HOST}:${port}`, stop: () => app.close() };
}

/** Один сценарий нагрузки: одинаковый запрос к обоим серверам */
interface Scenario {
  name: string;
  request: autocannon.Request;
}

const scenarios: Scenario[] = [
  { name: 'GET /users/:id', request: { method: 'GET', path: '/users/42' } },
  {
    name: 'POST /users',
    request: {
      method: 'POST',
      path: '/users',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Alice', email: 'alice@example.com' }),
    },
  },
];

/** Итог одного замера */
interface Measurement {
  rps: number;
  latencyAverage: number;
  latencyP99: number;
  errors: number;
  non2xx: number;
}

async function measure(url: string, scenario: Scenario): Promise<Measurement> {
  const result = await autocannon({
    url,
    connections: CONNECTIONS,
    duration: DURATION,
    requests: [scenario.request],
  });

  return {
    rps: result.requests.average,
    latencyAverage: result.latency.average,
    latencyP99: result.latency.p99,
    errors: result.errors,
    non2xx: result.non2xx,
  };
}

/** Прогревает сервер до замера, чтобы JIT не считался нагрузкой */
async function warmup(url: string, scenario: Scenario): Promise<void> {
  await autocannon({
    url,
    connections: 10,
    duration: 2,
    requests: [scenario.request],
  });
}

function row(name: string, value: Measurement): string {
  const rps = Math.round(value.rps).toString().padStart(9);
  const average = value.latencyAverage.toFixed(2).padStart(9);
  const p99 = value.latencyP99.toFixed(2).padStart(9);
  const bad = (value.errors + value.non2xx).toString().padStart(7);

  return `${name.padEnd(10)}${rps}${average}${p99}${bad}`;
}

async function main(): Promise<void> {
  const nestling = await startNestling();
  const fastify = await startFastify();

  console.log('Условия замера');
  console.log(`  дата:   ${new Date().toISOString().slice(0, 10)}`);
  console.log(`  node:   ${process.version}`);
  console.log(`  ос:     ${platform()} ${release()} ${arch()}`);
  console.log(`  cpu:    ${cpus()[0]?.model ?? 'unknown'} × ${cpus().length}`);
  console.log(`  нагрузка: ${CONNECTIONS} соединений, ${DURATION} c`);
  console.log('');

  try {
    for (const scenario of scenarios) {
      await warmup(nestling.url, scenario);
      await warmup(fastify.url, scenario);

      const measured = {
        nestling: await measure(nestling.url, scenario),
        fastify: await measure(fastify.url, scenario),
      };

      const ratio = measured.nestling.rps / measured.fastify.rps;

      console.log(scenario.name);
      console.log(
        `${'сервер'.padEnd(10)}${'req/s'.padStart(9)}${'ср. мс'.padStart(9)}${'p99 мс'.padStart(9)}${'ошибок'.padStart(7)}`,
      );
      console.log(row('nestling', measured.nestling));
      console.log(row('fastify', measured.fastify));
      console.log(`  отношение nestling/fastify: ${ratio.toFixed(2)}`);
      console.log('');
    }
  } finally {
    await nestling.stop();
    await fastify.stop();
  }
}

await main();
