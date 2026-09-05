# 20. CLI-утилита на тех же примитивах

> Гайд по текущему API; сверено с кодом `simple-cli` (2026-09-05).
> Целевое описание: [design/transports.md](../design/transports.md) §5,
> [design/endpoints.md](../design/endpoints.md). Почему так: запись
> [ideas.md](../decisions/ideas.md) «Endpoint-декларации: per-transport
> конструкторы, `deps`-инжект, формы хендлера».

Рядом с сервисом нужен консольный инструмент: разовая команда с
аргументами и обработка данных из stdin. Проверка входа, отказы со
статусом и кодом и форма `stream` работают так же, как в HTTP, без
второго набора правил для командной строки.

## Команда с аргументами

```typescript
// examples/simple-cli/src/commands/greet.command.ts
const GreetInput = z.object({
  args: z.array(z.string()).min(1, 'name is required'),
  shout: z.boolean().optional(),
});

const GreetOutput = z.object({
  greeting: z.string(),
});

export const Greet = cliEndpoint({
  command: 'greet',
  input: GreetInput,
  output: GreetOutput,
  handler: async ({ args, shout }) => {
    const text = `Hello, ${args[0]}!`;

    return { greeting: shout ? text.toUpperCase() : text };
  },
});
```

`cliEndpoint` объявляет команду так же, как `httpEndpoint` объявляет
маршрут: те же `input`, `output`, `errors`, `pipeline` и `handler`.
Вместо метода и пути у команды одно поле `command`, оно же
паттерн endpoint'а. Имя команды проверяется в момент создания
декларации: пустая строка в `command` — ошибка на импорте файла, а не
при разборе первой команды.

Вход команды собирается из аргументов процесса. Позиционные аргументы
попадают в массив `args`. Опция `--key value` становится полем `key`,
флаг `--flag` без значения даёт `true`. Собранный объект проверяет схема
`input` до вызова хендлера: обязательность имени задаёт
`z.array(...).min(1)`, а команда `greet` без имени отвечает отказом
`bad_request` с путём `args`, не вызывая хендлер.

```bash
yarn workspace @examples/simple-cli start:dev greet Alice --shout
```

```json
{
  "greeting": "HELLO, ALICE!"
}
```

Результат команды транспорт печатает в stdout как JSON. Хендлер не
пишет в консоль сам.

## Команда без входа

```typescript
// examples/simple-cli/src/commands/help.command.ts (фрагмент)
export const Help = cliEndpoint({
  command: 'help',
  output: HelpOutput,
  handler: async () => {
    console.log('Available commands:');
    // …
    return { message: 'Help displayed' };
  },
});
```

Команда без `input` получает пустой payload. Справку хендлер печатает
сам, потому что это его вывод для человека, а результатом отдаёт
подтверждение по схеме `output`.

## Поток из stdin

```typescript
// examples/simple-cli/src/commands/process-stdin.command.ts (фрагмент)
export const ProcessStdin = cliEndpoint({
  command: 'process-stdin',
  input: stream('binary'),
  output: ProcessStdinOutput,
  errors: [EmptyStdin],
  handler: async (
    payload: AsyncIterableIterator<Buffer>,
  ): Output<ProcessStdinOutput, typeof EmptyStdin> => {
    let linesProcessed = 0;
    let totalBytes = 0;

    for await (const chunk of payload) {
      totalBytes += chunk.length;
      // …
    }

    if (totalBytes === 0) {
      return EmptyStdin();
    }

    return { linesProcessed, totalBytes };
  },
});
```

Форма `stream('binary')` на входе отдаёт хендлеру чанки stdin как есть.
Форма `stream(T)` со схемой читала бы stdin как NDJSON и проверяла бы
каждую строку схемой, как в главе [10](./10-files-and-streams.md), а
потоковый `output` транспорт писал бы в stdout тем же NDJSON.

```typescript
// examples/simple-cli/src/errors.ts
export const EmptyStdin = makeFail('bad_request:empty_stdin', {
  message: 'No data received on stdin',
});
```

Отказ объявляется тем же `makeFail`, что и в HTTP: код вида
`категория:конкретный_повод`, из которого читается категория ответа, и
необязательные `message` и `details`. Категория не зависит от
транспорта: CLI печатает код как есть, HTTP перевело бы `bad_request` в
400.

```bash
printf "a\nb\n" | yarn workspace @examples/simple-cli start:dev process-stdin
```

```
Processing: a
Processing: b
{
  "linesProcessed": 2,
  "totalBytes": 4
}
```

## Транспорт и режимы запуска

```typescript
// examples/simple-cli/src/main.ts
const argv = process.argv.slice(2);

const cli = new CliTransport({
  mode: argv.length > 0 ? 'argv' : 'repl',
  argv,
});

const dispatch = makeDispatch([Help, Greet, ProcessStdin]);

const shutdown = new AbortController();

async function main() {
  if (argv.length === 0) {
    console.log('REPL mode: type a command or "exit"');
  }

  await cli.serve(dispatch, shutdown.signal);
  await cli.close();
}
```

Транспорт получает команды через `serve(dispatch, signal)`, как и HTTP.
Что значит «принимать запросы» для командной строки, задаёт режим. В
режиме `'argv'` выполняется одна команда из аргументов процесса, после
чего `serve` возвращается. В режиме `'repl'` команды читаются из stdin
до `exit`, `quit` или конца ввода. Пример выбирает режим по наличию
аргументов.

Формы `events` и `multipart` транспорт отклоняет при регистрации.
Ошибка называет команду и форму: у команды нет соединения, обрыв
которого был бы нормальным завершением, а файлы приходят путями в
аргументах.

Пример собирает `dispatch` напрямую, потому что у команд нет
зависимостей. Команде с классом-хендлером нужен контейнер: объявите её в
фиче и объявите приложение через `makeApp` с транспортом `cli()` в
`transports:`. Минимальный пример — в [README
пакета](../../packages/nestling.transport.cli/README.md).

## Проверка

Команды выполняются через `execute`: аргументы разбирает `parseArgv`,
ответ приходит значением, stdout в этом пути не участвует.

```typescript
// examples/simple-cli/src/commands.spec.ts (фрагмент)
describe('команды через execute', () => {
  let cli: CliTransport;

  beforeEach(async () => {
    // Пустой `argv`: `serve` регистрирует команды и ничего не выполняет
    cli = new CliTransport({ mode: 'argv', argv: [] });
    await cli.serve(
      makeDispatch([Help, Greet, ProcessStdin]),
      new AbortController().signal,
    );
  });

  it('собирает вход из позиционного аргумента и флага', async () => {
    const response = await cli.execute(
      parseArgv(['greet', 'Alice', '--shout']),
    );

    expect(response.isSuccess).toBe(true);
    expect(response.value).toEqual({ greeting: 'HELLO, ALICE!' });
  });

  it('отказывает по схеме, когда имени нет', async () => {
    const response = await cli.execute(parseArgv(['greet']));

    expect(response).toMatchObject({
      isSuccess: false,
      value: { code: 'bad_request' },
    });
  });

  it('не знает команду, которой нет в dispatch', async () => {
    await expect(cli.execute(parseArgv(['deploy']))).rejects.toThrow(
      'Command "deploy" not found',
    );
  });
  // …
});
```

`parseArgv` собирает вход из массива строк по тем же правилам, что и
запуск из терминала. Команда `process-stdin` читает `process.stdin`
напрямую, поэтому в тест через `execute` она не попала. Команда,
которой нет в `dispatch`, — не отказ значением, а исключение с её
именем: `execute` в этом случае не строит контекст запроса.

```bash
yarn workspace @examples/simple-cli start:dev            # REPL
yarn workspace @examples/simple-cli test
```

Глава [21. Логгер с именем потребителя и сбор вкладов](./21-token-families.md)
показывает семейства токенов: один рецепт на много зависимостей.
