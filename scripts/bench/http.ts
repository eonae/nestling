/**
 * Бенчмарк `@nestling/transport.http` относительно Fastify, Express и Hono.
 *
 * Каждый сервер поднимается в отдельном процессе (`bench/server.ts`), по
 * нему прогоняется autocannon из этого процесса, затем сервер
 * останавливается. Серверы и endpoint'ы описаны в `bench/servers.ts`.
 * Результат печатается таблицей на сценарий и сводной таблицей с
 * отношением к Fastify.
 *
 * Числа — точка отсчёта, а не порог: они зависят от машины замера,
 * поэтому скрипт живёт вне `yarn verify` и запускается вручную
 * (`yarn bench:http`).
 *
 * Переменные окружения:
 * - `BENCH_DURATION` — секунды на замер (по умолчанию 10);
 * - `BENCH_CONNECTIONS` — одновременных соединений (по умолчанию 50);
 * - `BENCH_SERVERS` — список серверов через запятую (по умолчанию все);
 * - `BENCH_NODE` — путь к бинарю Node для серверов (по умолчанию текущий).
 *
 * Флаг `--markdown` печатает сводную таблицу в Markdown для записи в
 * `docs/decisions/ideas.md`.
 *
 * Пакеты Nestling берутся из `dist`, поэтому перед запуском нужен
 * `yarn verify` или `yarn nx run-many -t build`.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { arch, cpus, platform, release } from 'node:os';
import { fileURLToPath } from 'node:url';

import autocannon from 'autocannon';

import { SERVERS } from './servers.js';

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

/** Бинарь Node, которым запускаются серверы */
const NODE = process.env.BENCH_NODE ?? process.execPath;

/** Серверы замера в порядке отчёта */
const SELECTED = (process.env.BENCH_SERVERS ?? Object.keys(SERVERS).join(','))
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean);

const MARKDOWN = process.argv.includes('--markdown');

/** Сервер, относительно которого считается отношение */
const REFERENCE = 'fastify';

const HOST = '127.0.0.1';

const SERVER_ENTRY = fileURLToPath(new URL('./server.ts', import.meta.url));
const TSX_CLI = fileURLToPath(import.meta.resolve('tsx/cli'));

for (const name of SELECTED) {
  if (!(name in SERVERS)) {
    console.error(
      `Неизвестный сервер '${name}' в BENCH_SERVERS. Известные: ${Object.keys(SERVERS).join(', ')}`,
    );
    process.exit(1);
  }
}

/** Запущенный в дочернем процессе сервер */
interface SpawnedServer {
  url: string;
  version: string;
  stop: () => Promise<void>;
}

/**
 * Поднимает сервер в дочернем процессе и ждёт строку `PORT=` на stdout.
 *
 * Дочерний процесс — `tsx` под бинарём `BENCH_NODE`: так один и тот же
 * замер снимается на разных версиях Node без пересборки.
 */
function spawnServer(name: string): Promise<SpawnedServer> {
  return new Promise((resolve, reject) => {
    const child = spawn(NODE, [TSX_CLI, SERVER_ENTRY, name], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });

    let output = '';
    let settled = false;

    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      const match = /PORT=(\d+)/.exec(output);
      const version = /NODE=(\S+)/.exec(output);
      if (match && version && !settled) {
        settled = true;
        resolve({
          url: `http://${HOST}:${match[1]}`,
          version: version[1],
          stop: () =>
            new Promise<void>((done) => {
              child.once('exit', () => done());
              child.kill('SIGTERM');
            }),
        });
      }
    });

    child.on('exit', (code) => {
      if (!settled) {
        settled = true;
        reject(
          new Error(
            `Сервер '${name}' завершился с кодом ${String(code)} до того, как сообщил порт`,
          ),
        );
      }
    });
  });
}

/** Один сценарий нагрузки: одинаковый запрос ко всем серверам */
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
  /** Разброс req/s между секундами замера: паузы видны здесь, а не в среднем */
  rpsStddev: number;
  latencyAverage: number;
  latencyP99: number;
  latencyMax: number;
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
    rpsStddev: result.requests.stddev,
    latencyAverage: result.latency.average,
    latencyP99: result.latency.p99,
    latencyMax: result.latency.max,
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

const COLUMNS = [
  ['сервер', 10],
  ['req/s', 9],
  ['σ req/s', 9],
  ['ср. мс', 9],
  ['p99 мс', 9],
  ['max мс', 9],
  ['ошибок', 7],
  ['к fastify', 10],
] as const;

function header(): string {
  return COLUMNS.map(([title, width], index) =>
    index === 0 ? title.padEnd(width) : title.padStart(width),
  ).join('');
}

function row(name: string, value: Measurement, ratio: number | undefined): string {
  const cells = [
    Math.round(value.rps).toString(),
    Math.round(value.rpsStddev).toString(),
    value.latencyAverage.toFixed(2),
    value.latencyP99.toFixed(2),
    value.latencyMax.toFixed(0),
    (value.errors + value.non2xx).toString(),
    ratio === undefined ? '—' : ratio.toFixed(2),
  ];

  return (
    name.padEnd(COLUMNS[0][1]) +
    cells.map((cell, index) => cell.padStart(COLUMNS[index + 1][1])).join('')
  );
}

/** Результаты: сервер → сценарий → замер */
type Results = Map<string, Map<string, Measurement>>;

function ratioTo(
  results: Results,
  server: string,
  scenario: string,
): number | undefined {
  const own = results.get(server)?.get(scenario)?.rps;
  const reference = results.get(REFERENCE)?.get(scenario)?.rps;

  return own === undefined || reference === undefined
    ? undefined
    : own / reference;
}

function printSummary(results: Results): void {
  const servers = [...results.keys()];

  if (MARKDOWN) {
    const head = scenarios.flatMap((s) => [`${s.name}, req/s`, 'к fastify']);
    console.log(`| сервер | ${head.join(' | ')} |`);
    console.log(`|---|${head.map(() => '---:').join('|')}|`);
    for (const server of servers) {
      const cells = scenarios.flatMap((s) => {
        const value = results.get(server)?.get(s.name);
        const ratio = ratioTo(results, server, s.name);
        return [
          value ? Math.round(value.rps).toLocaleString('ru-RU') : '—',
          ratio === undefined ? '—' : ratio.toFixed(2),
        ];
      });
      console.log(`| ${server} | ${cells.join(' | ')} |`);
    }
    return;
  }

  console.log('Сводка (среднее req/s и отношение к fastify)');
  const titles = scenarios.flatMap((s) => [s.name, 'к fastify']);
  console.log(
    'сервер'.padEnd(10) + titles.map((t) => t.padStart(16)).join(''),
  );
  for (const server of servers) {
    const cells = scenarios.flatMap((s) => {
      const value = results.get(server)?.get(s.name);
      const ratio = ratioTo(results, server, s.name);
      return [
        value ? Math.round(value.rps).toString() : '—',
        ratio === undefined ? '—' : ratio.toFixed(2),
      ];
    });
    console.log(server.padEnd(10) + cells.map((c) => c.padStart(16)).join(''));
  }
}

async function main(): Promise<void> {
  const results: Results = new Map();
  const versions = new Set<string>();

  for (const name of SELECTED) {
    const server = await spawnServer(name);
    versions.add(server.version);
    const own = new Map<string, Measurement>();
    results.set(name, own);

    try {
      for (const scenario of scenarios) {
        await warmup(server.url, scenario);
        own.set(scenario.name, await measure(server.url, scenario));
      }
    } finally {
      await server.stop();
    }
  }

  console.log('Условия замера');
  console.log(`  дата:     ${new Date().toISOString().slice(0, 10)}`);
  console.log(`  node:     ${[...versions].join(', ')} (серверы), ${process.version} (клиент)`);
  console.log(`  ос:       ${platform()} ${release()} ${arch()}`);
  console.log(`  cpu:      ${cpus()[0]?.model ?? 'unknown'} × ${cpus().length}`);
  console.log(`  нагрузка: ${CONNECTIONS} соединений, ${DURATION} c, сервер в отдельном процессе`);
  console.log('');

  for (const scenario of scenarios) {
    console.log(scenario.name);
    console.log(header());
    for (const [name, own] of results) {
      const value = own.get(scenario.name);
      if (value) {
        console.log(row(name, value, ratioTo(results, name, scenario.name)));
      }
    }
    console.log('');
  }

  printSummary(results);
}

await main();
