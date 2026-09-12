/**
 * Политика `missing: 'prompt'`: план вопросов, их форма и форма ответа.
 *
 * Терминала в тесте нет: потоки ввода и вывода подставляются опциями
 * транспорта, а вопросы включает `interactive: true` — подставленный поток
 * терминалом не является.
 */

import { sink, source } from './__fixtures__/streams.js';
import { cliEndpoint, CliTransport } from './index.js';

import { describe, expect, it } from '@jest/globals';
import { makeDispatch, makePipeline, Ok, stream } from '@nestlingjs/app';
import { zodConverter } from '@nestlingjs/schema.zod';
import { z } from 'zod';

const Deploy = z.object({
  env: z.enum(['dev', 'prod']),
  force: z.boolean(),
  host: z.string().describe('Target host').meta({ default: 'localhost' }),
});

/** Команда со всеми тремя формами вопроса */
function deployCommand(seen: Record<string, unknown>[]) {
  return cliEndpoint({
    command: 'deploy',
    input: Deploy,
    output: z.object({ done: z.boolean() }),
    missing: 'prompt',
    pipeline: makePipeline(),
    handler: async (payload: z.infer<typeof Deploy>) => {
      seen.push({ ...payload });

      return new Ok({ done: true });
    },
  });
}

describe('политика в декларации', () => {
  it('команда без поля missing поля binding не несёт', () => {
    const Status = cliEndpoint({
      command: 'status',
      output: z.object({ ok: z.boolean() }),
      handler: async () => new Ok({ ok: true }),
    });

    expect(Status.binding).toBeUndefined();
  });

  it('политика видна транспорту на проекции маршрута', () => {
    const Deploying = deployCommand([]);

    expect(Deploying.binding).toEqual({ missing: 'prompt' });
    expect(makeDispatch([Deploying]).routes[0].binding).toEqual({
      missing: 'prompt',
    });
  });

  it('неизвестная политика — ошибка в момент создания', () => {
    expect(() =>
      cliEndpoint({
        command: 'deploy',
        // @ts-expect-error политик две, третьей не бывает
        missing: 'ask',
        handler: async () => new Ok({}),
      }),
    ).toThrow(/'missing' must be 'error' or 'prompt'/);
  });

  it('команда без политики отказывает валидацией, вопросов не задаёт', async () => {
    const Plain = cliEndpoint({
      command: 'deploy',
      input: Deploy,
      output: z.object({ done: z.boolean() }),
      pipeline: makePipeline(),
      handler: async () => new Ok({ done: true }),
    });

    const output = sink();
    const cli = new CliTransport({
      argv: [],
      input: source('prod\n', 'y\n'),
      output,
      interactive: true,
      converters: [zodConverter()],
    });

    await cli.serve(makeDispatch([Plain]), new AbortController().signal);

    try {
      const response = await cli.execute({
        command: 'deploy',
        args: [],
        options: {},
      });

      expect(response).toMatchObject({
        isSuccess: false,
        status: 'bad_request',
      });
      expect(output.text).toBe('');
    } finally {
      await cli.close();
    }
  });
});

describe('вопросы в терминале', () => {
  it('выбор из списка, подтверждение и подсказка с умолчанием', async () => {
    const seen: Record<string, unknown>[] = [];
    const output = sink();

    const cli = new CliTransport({
      argv: [],
      input: source('2\n', 'y\n', '\n'),
      output,
      interactive: true,
      converters: [zodConverter()],
    });

    await cli.serve(
      makeDispatch([deployCommand(seen)]),
      new AbortController().signal,
    );

    try {
      const response = await cli.execute({
        command: 'deploy',
        args: [],
        options: {},
      });

      expect(response).toMatchObject({ isSuccess: true });
      expect(seen).toEqual([{ env: 'prod', force: true, host: 'localhost' }]);

      // Нумерованный список, форма подтверждения, подсказка и умолчание
      expect(output.text).toContain('  1) dev');
      expect(output.text).toContain('  2) prod');
      expect(output.text).toContain('force [y/n]: ');
      expect(output.text).toContain('Target host');
      expect(output.text).toContain('host (localhost): ');
    } finally {
      await cli.close();
    }
  });

  it('заданное флагом поле не спрашивается', async () => {
    const seen: Record<string, unknown>[] = [];
    const output = sink();

    const cli = new CliTransport({
      argv: [],
      input: source('n\n', '\n'),
      output,
      interactive: true,
      converters: [zodConverter()],
    });

    await cli.serve(
      makeDispatch([deployCommand(seen)]),
      new AbortController().signal,
    );

    try {
      await cli.execute({
        command: 'deploy',
        args: [],
        options: { env: 'prod' },
      });

      expect(seen).toEqual([{ env: 'prod', force: false, host: 'localhost' }]);
      expect(output.text).not.toContain('1) dev');
    } finally {
      await cli.close();
    }
  });

  it('число вводится строкой и приводится схемой, как флаг', async () => {
    const seen: number[] = [];

    const Repeat = cliEndpoint({
      command: 'repeat',
      input: z.object({ count: z.coerce.number() }),
      output: z.object({ count: z.number() }),
      missing: 'prompt',
      pipeline: makePipeline(),
      handler: async ({ count }: { count: number }) => {
        seen.push(count);

        return new Ok({ count });
      },
    });

    const cli = new CliTransport({
      argv: [],
      input: source('3\n'),
      output: sink(),
      interactive: true,
      converters: [zodConverter()],
    });

    await cli.serve(makeDispatch([Repeat]), new AbortController().signal);

    try {
      const response = await cli.execute({
        command: 'repeat',
        args: [],
        options: {},
      });

      expect(response).toMatchObject({ isSuccess: true, value: { count: 3 } });
      expect(seen).toEqual([3]);
    } finally {
      await cli.close();
    }
  });

  it('поле непонятной формы вопроса не даёт: его забирает валидация', async () => {
    const Tag = cliEndpoint({
      command: 'tag',
      input: z.object({ tags: z.array(z.string()) }),
      output: z.object({ tagged: z.number() }),
      missing: 'prompt',
      pipeline: makePipeline(),
      handler: async () => new Ok({ tagged: 0 }),
    });

    const output = sink();
    const cli = new CliTransport({
      argv: [],
      input: source('a\n'),
      output,
      interactive: true,
      converters: [zodConverter()],
    });

    await cli.serve(makeDispatch([Tag]), new AbortController().signal);

    try {
      const response = await cli.execute({
        command: 'tag',
        args: [],
        options: {},
      });

      expect(response).toMatchObject({
        isSuccess: false,
        status: 'bad_request',
      });
      expect(output.text).toBe('');
    } finally {
      await cli.close();
    }
  });

  it('конец ввода оставляет поле незаданным', async () => {
    const output = sink();
    const cli = new CliTransport({
      argv: [],
      input: source(),
      output,
      interactive: true,
      converters: [zodConverter()],
    });

    await cli.serve(
      makeDispatch([deployCommand([])]),
      new AbortController().signal,
    );

    try {
      const response = await cli.execute({
        command: 'deploy',
        args: [],
        options: {},
      });

      expect(response).toMatchObject({
        isSuccess: false,
        status: 'bad_request',
      });
    } finally {
      await cli.close();
    }
  });
});

describe('вне терминала вопросы отключены', () => {
  it('подставленный поток без опции interactive терминалом не считается', async () => {
    const output = sink();
    const cli = new CliTransport({
      argv: [],
      input: source('2\n', 'y\n', '\n'),
      output,
      converters: [zodConverter()],
    });

    await cli.serve(
      makeDispatch([deployCommand([])]),
      new AbortController().signal,
    );

    try {
      const response = await cli.execute({
        command: 'deploy',
        args: [],
        options: {},
      });

      expect(response).toMatchObject({
        isSuccess: false,
        status: 'bad_request',
      });
      expect(output.text).toBe('');
    } finally {
      await cli.close();
    }
  });

  it('переменная CI отменяет вопросы у терминала', async () => {
    const terminal = source('2\n', 'y\n', '\n');
    Object.defineProperty(terminal, 'isTTY', { value: true });

    const before = process.env.CI;
    process.env.CI = 'true';

    const output = sink();
    const cli = new CliTransport({
      argv: [],
      input: terminal,
      output,
      converters: [zodConverter()],
    });

    await cli.serve(
      makeDispatch([deployCommand([])]),
      new AbortController().signal,
    );

    try {
      const response = await cli.execute({
        command: 'deploy',
        args: [],
        options: {},
      });

      expect(response).toMatchObject({
        isSuccess: false,
        status: 'bad_request',
      });
      expect(output.text).toBe('');
    } finally {
      if (before === undefined) {
        delete process.env.CI;
      } else {
        process.env.CI = before;
      }
      await cli.close();
    }
  });

  it('опция interactive: false отменяет вопросы у терминала без CI', async () => {
    const terminal = source('2\n', 'y\n', '\n');
    Object.defineProperty(terminal, 'isTTY', { value: true });

    const output = sink();
    const cli = new CliTransport({
      argv: [],
      input: terminal,
      output,
      interactive: false,
      converters: [zodConverter()],
    });

    await cli.serve(
      makeDispatch([deployCommand([])]),
      new AbortController().signal,
    );

    try {
      const response = await cli.execute({
        command: 'deploy',
        args: [],
        options: {},
      });

      expect(response).toMatchObject({
        isSuccess: false,
        status: 'bad_request',
      });
      expect(output.text).toBe('');
    } finally {
      await cli.close();
    }
  });
});

describe('вопрос внутри REPL', () => {
  it('ответ уходит в вопрос, а не разбирается как следующая команда', async () => {
    const seen: Record<string, unknown>[] = [];
    const output = sink();

    const cli = new CliTransport({
      mode: 'repl',
      input: source('deploy\n', '2\n', 'y\n', '\n', 'exit\n'),
      output,
      interactive: true,
      converters: [zodConverter()],
    });

    await cli.serve(
      makeDispatch([deployCommand(seen)]),
      new AbortController().signal,
    );

    try {
      // Три строки после `deploy` ушли в три вопроса: команда выполнена
      // один раз и с достроенным входом
      expect(seen).toEqual([{ env: 'prod', force: true, host: 'localhost' }]);
      expect(output.text).toContain('"done": true');
    } finally {
      await cli.close();
    }
  });
});

describe('ошибки serve', () => {
  it('нет конвертера для вендора схемы', async () => {
    const cli = new CliTransport({ argv: [], input: source(), output: sink() });

    await expect(
      cli.serve(
        makeDispatch([deployCommand([])]),
        new AbortController().signal,
      ),
    ).rejects.toThrow(/Command "deploy" .* vendor 'zod'.* cli\({ converters/s);
  });

  it('поток на входе вместе с политикой', async () => {
    const Import = cliEndpoint({
      command: 'import',
      input: stream('binary'),
      output: z.object({ bytes: z.number() }),
      missing: 'prompt',
      pipeline: makePipeline(),
      handler: async () => new Ok({ bytes: 0 }),
    });

    const cli = new CliTransport({
      argv: [],
      input: source(),
      output: sink(),
      converters: [zodConverter()],
    });

    await expect(
      cli.serve(makeDispatch([Import]), new AbortController().signal),
    ).rejects.toThrow(/Command "import" declares input: stream/);
  });

  it('конвертер нужен только командам с политикой', async () => {
    const Status = cliEndpoint({
      command: 'status',
      input: z.object({ verbose: z.boolean().optional() }),
      output: z.object({ ok: z.boolean() }),
      pipeline: makePipeline(),
      handler: async () => new Ok({ ok: true }),
    });

    const cli = new CliTransport({ argv: [], input: source(), output: sink() });

    await expect(
      cli.serve(makeDispatch([Status]), new AbortController().signal),
    ).resolves.toBeUndefined();

    await cli.close();
  });

  it('схема конвертируется один раз — при serve, а не на каждый вызов', async () => {
    const zod = zodConverter();
    let calls = 0;

    const counting = {
      vendor: zod.vendor,
      toJsonSchema: (
        schema: Parameters<typeof zod.toJsonSchema>[0],
        options?: Parameters<typeof zod.toJsonSchema>[1],
      ) => {
        calls++;

        return zod.toJsonSchema(schema, options);
      },
    };

    const cli = new CliTransport({
      argv: [],
      input: source('1\n', 'n\n', '\n', '1\n', 'n\n', '\n'),
      output: sink(),
      interactive: true,
      converters: [counting],
    });

    await cli.serve(
      makeDispatch([deployCommand([])]),
      new AbortController().signal,
    );

    try {
      await cli.execute({ command: 'deploy', args: [], options: {} });
      await cli.execute({ command: 'deploy', args: [], options: {} });

      expect(calls).toBe(1);
    } finally {
      await cli.close();
    }
  });
});
