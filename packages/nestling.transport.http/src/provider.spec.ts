/**
 * Транспорт как обычный провайдер: конфиг-секция, приоритет опций и
 * фактический адрес после старта приёма запросов.
 */

import { HttpTransport$ } from './token';
import { http, HttpTransport } from './transport';

import { describe, expect, it } from '@jest/globals';
import { configKernel } from '@nestling/config';
import { ContainerBuilder } from '@nestling/container';
import { makeDispatch } from '@nestling/transport';

/** Строит контейнер с kernel-модулем конфига и провайдером транспорта */
async function build(provider: ReturnType<typeof http>) {
  return await new ContainerBuilder()
    .register(configKernel([], { onWarn: (): void => undefined }))
    .register(provider)
    .build();
}

/** Выставляет одну переменную окружения или снимает её */
function applyEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    Reflect.deleteProperty(process.env, key);
  } else {
    process.env[key] = value;
  }
}

/** Ставит переменные окружения на время одного теста */
function withEnv(vars: Record<string, string | undefined>): () => void {
  const previous = new Map(
    Object.keys(vars).map((key) => [key, process.env[key]]),
  );

  for (const [key, value] of Object.entries(vars)) {
    applyEnv(key, value);
  }

  return () => {
    for (const [key, value] of previous) {
      applyEnv(key, value);
    }
  };
}

/** Опции транспорта, снятые с инстанса: они приватны, но проверяемы */
const optionsOf = (transport: HttpTransport): { port?: number } =>
  (transport as unknown as { options: { port?: number } }).options;

describe('http() — фабрика провайдера', () => {
  it('порт берётся из конфиг-секции', async () => {
    const restore = withEnv({ HTTP_PORT: '8080' });

    try {
      const container = await build(http());
      const transport = container.getOrThrow(HttpTransport$) as HttpTransport;

      expect(optionsOf(transport).port).toBe(8080);
    } finally {
      restore();
    }
  });

  it('явная опция перекрывает конфиг', async () => {
    const restore = withEnv({ HTTP_PORT: '8080' });

    try {
      const container = await build(http({ port: 3000 }));
      const transport = container.getOrThrow(HttpTransport$) as HttpTransport;

      expect(optionsOf(transport).port).toBe(3000);
    } finally {
      restore();
    }
  });

  it('невалидное значение конфига валит сборку до захвата сокета', async () => {
    const restore = withEnv({ HTTP_PORT: 'abc' });

    try {
      await expect(build(http())).rejects.toThrow(/HTTP_PORT/);
    } finally {
      restore();
    }
  });

  it('без переменных окружения работает дефолт транспорта', async () => {
    const restore = withEnv({ HTTP_PORT: undefined, HTTP_HOST: undefined });

    try {
      const container = await build(http());
      const transport = container.getOrThrow(HttpTransport$) as HttpTransport;

      expect(optionsOf(transport).port).toBe(3000);
    } finally {
      restore();
    }
  });
});

describe('HttpTransport.address()', () => {
  it('до serve адреса нет', () => {
    expect(new HttpTransport({ port: 0 }).address()).toBeNull();
  });

  it('после serve отдаёт фактически занятый порт, после close — null', async () => {
    const transport = new HttpTransport({ port: 0, host: '127.0.0.1' });

    await transport.serve(makeDispatch([]), new AbortController().signal);

    const address = transport.address();
    expect(address).not.toBeNull();
    expect(address?.port).toBeGreaterThan(0);

    await transport.close();
    expect(transport.address()).toBeNull();
  });

  it('взвод сигнала останавливает транспорт', async () => {
    const transport = new HttpTransport({ port: 0, host: '127.0.0.1' });
    const controller = new AbortController();

    await transport.serve(makeDispatch([]), controller.signal);
    controller.abort();

    // Остановка асинхронна: ждём микрозадачи обработчика сигнала
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(transport.address()).toBeNull();
  });
});
