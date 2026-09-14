/**
 * Прогон тестов против настоящих служб, а не двойников.
 *
 * Двойник подтверждает наш код: он ведёт себя так, как мы поняли брокер.
 * Совместимость с брокером подтверждает только брокер, и без этого прогона
 * расхождение находит потребитель пакета, а не мы.
 *
 * Скрипт поднимает службу из `compose.yaml`, ждёт её порт, гоняет тесты
 * пакета с переменной, которая включает интеграционный suite, и
 * останавливает службу. Код возврата — код прогона тестов: служба
 * останавливается в любом исходе, в том числе по Ctrl-C.
 *
 * Готовность ждёт скрипт, а не `healthcheck` службы: официальный образ
 * `nats:2` собран без оболочки, и команде проверки внутри контейнера
 * взяться неоткуда.
 *
 * Прогон: `yarn test:live`. В `yarn verify` не входит: требует Docker.
 */
import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

/** Служба, её порт и пакет, чьи тесты идут против неё */
const TARGET = {
  service: 'nats',
  host: '127.0.0.1',
  // Тот же порт, что публикует `compose.yaml`: 4222 занят у всякого, кто
  // держит свой брокер, и `NATS_LIVE_PORT` читают оба
  port: Number(process.env.NATS_LIVE_PORT ?? 4222),
  workspace: '@nestlingjs/transport.nats',
  env: 'NATS_TEST_SERVERS',
  url: (host, port) => `nats://${host}:${port}`,
};

/** Потолок ожидания порта: дольше — значит служба не поднялась */
const READY_TIMEOUT_MS = 60_000;
const PROBE_INTERVAL_MS = 250;

/** Запускает команду, отдавая её вывод дальше, и возвращает код выхода */
const run = (command, args, env = {}) =>
  new Promise((resolveCode, rejectSpawn) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, ...env },
    });

    child.on('error', rejectSpawn);
    child.on('close', (code) => resolveCode(code ?? 1));
  });

/** Одна попытка соединения: порт принимает — служба готова */
const probe = (host, port) =>
  new Promise((resolveReady) => {
    const socket = connect({ host, port });
    const finish = (ready) => {
      socket.destroy();
      resolveReady(ready);
    };

    socket.setTimeout(PROBE_INTERVAL_MS);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });

/** Ждёт порт до потолка; не дождался — бросает */
const waitForPort = async (host, port) => {
  const deadline = Date.now() + READY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (await probe(host, port)) {
      return;
    }

    await new Promise((tick) => setTimeout(tick, PROBE_INTERVAL_MS));
  }

  throw new Error(
    `service '${TARGET.service}' did not open ${host}:${port} within ` +
      `${READY_TIMEOUT_MS / 1000}s`,
  );
};

const compose = (...args) => run('docker', ['compose', ...args]);

const stop = async () => {
  console.log(`[test-live] stopping '${TARGET.service}'`);
  await compose('down', '--remove-orphans');
};

let stopping = false;

// Ctrl-C посреди прогона оставил бы службу поднятой: сигнал перехватывается,
// служба останавливается, и код выхода остаётся сигнальным
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (stopping) {
      return;
    }

    stopping = true;
    void stop().finally(() => process.exit(1));
  });
}

console.log(`[test-live] starting '${TARGET.service}'`);

const started = await compose('up', '-d', TARGET.service);

if (started !== 0) {
  console.error(
    `[test-live] 'docker compose up' failed. Is the Docker daemon running?`,
  );
  process.exit(started);
}

let code = 1;

try {
  await waitForPort(TARGET.host, TARGET.port);
  console.log(`[test-live] '${TARGET.service}' is ready, running tests`);

  code = await run('yarn', ['workspace', TARGET.workspace, 'test'], {
    [TARGET.env]: TARGET.url(TARGET.host, TARGET.port),
  });
} catch (error) {
  console.error(`[test-live] ${error.message}`);
  await compose('logs', '--no-color', '--tail', '50', TARGET.service);
} finally {
  if (!stopping) {
    stopping = true;
    await stop();
  }
}

process.exit(code);
