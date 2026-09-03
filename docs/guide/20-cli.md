# 20. CLI-утилита на тех же примитивах

> Гайд по текущему API; сверено с кодом `examples.simple-cli` (2026-09-03).
> Целевое описание: [design/transports.md](../design/transports.md) §5,
> [design/endpoints.md](../design/endpoints.md). Почему так: запись
> [ideas.md](../decisions/ideas.md) «Endpoint-декларации: per-transport
> конструкторы, `deps`-инжект, формы хендлера».

## Задача

Рядом с сервисом нужен консольный инструмент: разовая команда с
аргументами и обработка данных из stdin. Проверка входа, отказы со
статусом и кодом и форма `stream` должны работать так же, как в HTTP,
без второго набора правил для командной строки.

## Решение

### Объявите команду с аргументами

```typescript
// packages/examples.simple-cli/src/commands/greet.command.ts
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
маршрут: те же `input`, `output`, `errors`, `pipeline`, `deps` и
`handle`. Вместо метода и пути у команды одно поле `command`, оно же
паттерн endpoint'а.

Вход команды собирается из аргументов процесса. Позиционные аргументы
попадают в массив `args`. Опция `--key value` становится полем `key`,
флаг `--flag` без значения даёт `true`. Собранный объект проверяет схема
`input`, поэтому обязательность имени задаёт `z.array(...).min(1)`.

```bash
yarn workspace examples.simple-cli start:dev greet Alice --shout
```

```json
{
  "greeting": "HELLO, ALICE!"
}
```

Результат команды транспорт печатает в stdout как JSON. Хендлер не
пишет в консоль сам.

### Объявите команду без входа

```typescript
// packages/examples.simple-cli/src/commands/help.command.ts
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

### Прочитайте stdin как поток

```typescript
// packages/examples.simple-cli/src/commands/process-stdin.command.ts
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
Форма `stream(T)` со схемой читала бы stdin как NDJSON и проверяла каждую
строку схемой, как в главе [10](./10-files-and-streams.md). Потоковый
`output` транспорт пишет в stdout тем же NDJSON.

```typescript
// packages/examples.simple-cli/src/errors.ts
export const EmptyStdin = makeFail('bad_request:empty_stdin', {
  status: 'bad_request',
  message: 'No data received on stdin',
});
```

Отказ объявляется тем же `makeFail`, что и в HTTP. Статус не зависит от
транспорта: HTTP перевёл бы `bad_request` в 400, CLI печатает его как
есть.

```bash
printf "a\nb\n" | yarn workspace examples.simple-cli start:dev process-stdin
```

```
Processing: a
Processing: b
{
  "linesProcessed": 2,
  "totalBytes": 4
}
```

### Запустите транспорт

```typescript
// packages/examples.simple-cli/src/main.ts
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

Пример собирает `dispatch` напрямую, потому что у команд нет
зависимостей. Команде с `deps` нужен контейнер: объявите её в фиче и
объявите приложение через `makeApp` с транспортом `cli()` в `transports:`. Как это
выглядит, показывает минимальный пример в
[README пакета](../../packages/nestling.transport.cli/README.md). Сборка
без `makeApp` разобрана в главе [24](./24-standalone.md).

## Что гарантирует фреймворк

- Вход проверяется схемой до вызова хендлера. Команда `greet` без имени
  печатает `bad_request` с кодом `bad_request` и путём `args`, а
  хендлер не вызывается.
- Пустое имя команды останавливает создание декларации, а не запуск.
- Формы `events` и `multipart` транспорт отклоняет при регистрации.
  Ошибка называет команду и форму: у команды нет соединения, обрыв
  которого был бы нормальным завершением, а файлы приходят путями в
  аргументах.
- Команда, которой нет в `dispatch`, даёт ошибку с именем команды.

## Как проверить

```typescript
// packages/examples.simple-cli/src/commands.spec.ts
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
```

`parseArgv` собирает вход из массива строк по тем же правилам, что и
запуск из терминала. `execute` выполняет одну команду через `dispatch` и
возвращает ответ значением, ничего не печатая. Команда `process-stdin`
читает `process.stdin` напрямую, поэтому в тест через `execute` она не
попала.

## Запускаемый код

| Файл | Что показывает |
|---|---|
| `packages/examples.simple-cli/src/commands/greet.command.ts` | вход `{ args, ...options }` |
| `packages/examples.simple-cli/src/commands/help.command.ts` | команда без входа |
| `packages/examples.simple-cli/src/commands/process-stdin.command.ts` | `stream('binary')` из stdin и отказ |
| `packages/examples.simple-cli/src/errors.ts` | отказ с транспортно-независимой категорией |
| `packages/examples.simple-cli/src/main.ts` | `CliTransport` в режимах argv и REPL |
| `packages/examples.simple-cli/src/commands.spec.ts` | команды через `execute(parseArgv(...))` |

```bash
yarn workspace examples.simple-cli start:dev greet Alice --shout
printf "a\nb\n" | yarn workspace examples.simple-cli start:dev process-stdin
yarn workspace examples.simple-cli start:dev            # REPL
yarn workspace examples.simple-cli test
```

## Дальше

Глава [21. Логгер с именем потребителя и сбор вкладов](./21-token-families.md)
показывает семейства токенов: один рецепт на много зависимостей.
