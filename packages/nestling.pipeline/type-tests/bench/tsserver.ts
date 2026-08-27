/**
 * Замер латентности редакторских операций через настоящий `tsserver`.
 *
 * Сервер поднимается напрямую по его протоколу (spawn
 * `node_modules/typescript/lib/tsserver.js`, обмен JSON-сообщениями) —
 * новой зависимости для этого не появляется.
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

import type { Probe } from './generate.js';

const require = createRequire(import.meta.url);

/** Ответ на один запрос протокола */
interface ServerResponse {
  type: string;
  command?: string;
  request_seq?: number;
  success?: boolean;
  message?: string;
  body?: unknown;
}

const RESPONSE_TIMEOUT_MS = 180_000;

class TsServer {
  private seq = 0;
  private buffer = '';
  private readonly pending = new Map<
    number,
    { resolve: (r: ServerResponse) => void; reject: (e: Error) => void }
  >();

  private readonly child;

  constructor() {
    const tsserverPath = resolve(
      dirname(require.resolve('typescript')),
      'tsserver.js',
    );

    this.child = spawn(
      process.execPath,
      [tsserverPath, '--disableAutomaticTypingAcquisition'],
      { stdio: ['pipe', 'pipe', 'inherit'] },
    );

    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => this.onData(chunk));
  }

  /** Отправляет запрос и ждёт ответ с тем же `request_seq` */
  request(command: string, args: unknown): Promise<ServerResponse> {
    const seq = ++this.seq;
    const promise = new Promise<ServerResponse>((res, rej) => {
      const timer = setTimeout(() => {
        this.pending.delete(seq);
        rej(new Error(`tsserver: нет ответа на ${command} за ${RESPONSE_TIMEOUT_MS} мс`));
      }, RESPONSE_TIMEOUT_MS);

      this.pending.set(seq, {
        resolve: (r) => {
          clearTimeout(timer);
          res(r);
        },
        reject: (e) => {
          clearTimeout(timer);
          rej(e);
        },
      });
    });

    this.send({ seq, type: 'request', command, arguments: args });
    return promise;
  }

  /** Отправляет запрос, у которого ответа нет (`open`, `configure`) */
  notify(command: string, args: unknown): void {
    this.send({ seq: ++this.seq, type: 'request', command, arguments: args });
  }

  dispose(): void {
    this.child.kill();
  }

  private send(message: unknown): void {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private onData(chunk: string): void {
    this.buffer += chunk;

    // tsserver отвечает кадрами `Content-Length: N\r\n\r\n<json>`; на всякий
    // случай поддерживается и «голый» JSON построчно.
    for (;;) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) {
        const newline = this.buffer.indexOf('\n');
        if (newline === -1) {
          return;
        }
        const line = this.buffer.slice(0, newline).trim();
        this.buffer = this.buffer.slice(newline + 1);
        this.dispatch(line);
        continue;
      }

      const header = this.buffer.slice(0, headerEnd);
      const match = /Content-Length: (\d+)/.exec(header);
      if (!match) {
        this.buffer = this.buffer.slice(headerEnd + 4);
        continue;
      }

      const length = Number(match[1]);
      const body = this.buffer.slice(headerEnd + 4);
      if (Buffer.byteLength(body, 'utf8') < length) {
        return;
      }

      this.buffer = body.slice(length);
      this.dispatch(body.slice(0, length));
    }
  }

  private dispatch(payload: string): void {
    if (!payload.startsWith('{')) {
      return;
    }

    let message: ServerResponse;
    try {
      message = JSON.parse(payload) as ServerResponse;
    } catch {
      return;
    }

    if (message.type !== 'response' || message.request_seq === undefined) {
      return;
    }

    const waiter = this.pending.get(message.request_seq);
    if (!waiter) {
      return;
    }
    this.pending.delete(message.request_seq);
    waiter.resolve(message);
  }
}

export interface LatencyResult {
  /** Первый запрос: включает загрузку проекта — печатается справочно */
  warmupMs: number;
  /** Медиана установившейся латентности hover */
  quickinfoMs: number;
  /** Медиана установившейся латентности автокомплита */
  completionMs: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Пустой ответ означал бы, что меряется не работа сервера, а отказ:
 * такой замер обязан валить прогон, а не показывать «1 ms».
 */
function assertAnswered(response: ServerResponse, what: string): void {
  if (response.success === false || response.body === undefined) {
    throw new Error(
      `tsserver: ${what} не дал ответа (${response.message ?? 'пустое тело'}) — ` +
        'позиция курсора в сгенерированном графе разъехалась с generate.ts',
    );
  }
}

/**
 * Меряет hover и автокомплит на сгенерированном графе.
 *
 * @param file - абсолютный путь к файлу графа
 * @param probes - позиции курсора, посчитанные генератором
 * @param samples - число замеров после прогрева; берётся медиана
 */
export async function measureLatency(
  file: string,
  probes: { hover: Probe; completion: Probe; endLine: number },
  samples = 5,
): Promise<LatencyResult> {
  const server = new TsServer();
  let endLine = probes.endLine;

  /**
   * Дописывает строку в конец файла. Позиции проб не сдвигаются, а кэш
   * сервера инвалидируется: следующий hover считает тип заново — ровно то,
   * что чувствует пользователь, редактируя файл.
   */
  const touch = (): void => {
    server.notify('change', {
      file,
      line: endLine,
      offset: 1,
      endLine,
      endOffset: 1,
      insertString: '//\n',
    });
    endLine += 1;
  };

  try {
    server.notify('configure', {
      hostInfo: 'nestling-type-budget',
      preferences: { includePackageJsonAutoImports: 'off' },
    });
    server.notify('open', { file, projectRootPath: dirname(file) });

    // Прогрев: первый запрос тянет за собой загрузку проекта и разбор
    // всего графа. Латентность редактора — это установившееся состояние.
    const warmupStarted = performance.now();
    assertAnswered(
      await server.request('quickinfo', { file, ...probes.hover }),
      'quickinfo (прогрев)',
    );
    const warmupMs = performance.now() - warmupStarted;

    const quickinfo: number[] = [];
    const completion: number[] = [];

    for (let i = 0; i < samples; i++) {
      touch();
      const q = performance.now();
      assertAnswered(
        await server.request('quickinfo', { file, ...probes.hover }),
        'quickinfo',
      );
      quickinfo.push(performance.now() - q);

      touch();
      const c = performance.now();
      assertAnswered(
        await server.request('completionInfo', {
          file,
          ...probes.completion,
          includeExternalModuleExports: false,
        }),
        'completionInfo',
      );
      completion.push(performance.now() - c);
    }

    return {
      warmupMs,
      quickinfoMs: median(quickinfo),
      completionMs: median(completion),
    };
  } finally {
    server.dispose();
  }
}
