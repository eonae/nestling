# CLI-утилита на тех же примитивах

> Гайд по текущему API; сверено с кодом `561d1000`.
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
// src/commands/greet.command.ts
const GreetInput = z.object({
  args: z.array(z.string()).min(1, 'name is required'),
  shout: z.boolean().optional(),
});

const GreetOutput = z.object({
  greeting: z.string(),
});

export const Greet = cliEndpoint('greet', {
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
yarn start:dev greet Alice --shout
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
// src/commands/help.command.ts (фрагмент)
export const Help = cliEndpoint('help', {
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

## Недостающий вход

```typescript
// src/commands/deploy.command.ts
const DeployInput = z.object({
  env: z.enum(['dev', 'prod']).describe('Target environment'),
  force: z.boolean().describe('Skip the safety checks'),
  host: z.string().describe('Deployment host').meta({ default: 'localhost' }),
});

export const Deploy = cliEndpoint('deploy', {
  input: DeployInput,
  output: DeployOutput,
  missing: 'prompt',
  handler: async ({ env, force, host }) => ({ env, host, forced: force }),
});
```

Поле `missing` решает, что делает команда без обязательного флага.
Умолчание `'error'` оставляет отказ `bad_request` с путём поля.
`'prompt'` спрашивает недостающее в терминале и выполняет команду с
достроенным входом.

Вопросы выводятся из схемы, а не объявляются рядом с ней. `enum` даёт
нумерованный список, `boolean` — подтверждение `[y/n]`, строка и число —
ввод строки. `description` печатается подсказкой, `default` узла
показывается в скобках и подставляется по пустому вводу.

Умолчание объявляется аннотацией `meta`, а не `default`. Поле с
`.default('localhost')` необязательно: схема подставляет значение сама, и
недостающим оно не бывает. `meta({ default: 'localhost' })` оставляет поле
обязательным и говорит другое — «вот значение, которое я бы взял; спроси,
но предложи его».

Ответ кладётся в той же форме, в какой его дал бы флаг: строка для
скаляра, `true` или `false` для подтверждения, элемент списка для выбора.
Схема, написанная под аргументы командной строки (`z.coerce.number()` там,
где нужно число), работает с вопросами без единой правки.

```bash
yarn start:dev deploy
```

```
Target environment
  1) dev
  2) prod
env: 2
Skip the safety checks
force [y/n]: y
Deployment host
host (localhost):
{
  "env": "prod",
  "host": "localhost",
  "forced": true
}
```

Вопрос выводится из JSON Schema формы `input`: Standard Schema
интроспекции не даёт, и схему кто-то должен перевести. Объявлять переводчик
не нужно — конвертер вендора, на котором написаны схемы фреймворка,
транспорт подставляет умолчанием. Приложение на другом валидаторе передаёт
свой список опцией `cli({ converters })`. Схема, которую не перевёл ни один
конвертер, роняет `serve` с именем команды и вендором её схемы, а не молча
задаёт вопросы по одним именам полей.

Вопросы задаются, пока ввод — терминал и переменная `CI` не задана. В
конвейере команда доходит до валидации и отвечает отказом, как команда без
политики: процесс не зависает на вопросе, которого никто не увидит.
Решить явно позволяет опция `cli({ interactive })`.

Спрашиваются только обязательные поля понятной формы. Массив и вложенный
объект вопроса не дают: такое поле остаётся пустым и даёт отказ валидации.
Поток на входе вместе с политикой роняет `serve` — вопросы и поток читают
один и тот же ввод.

## Поток из stdin

```typescript
// src/commands/process-stdin.command.ts (фрагмент)
export const ProcessStdin = cliEndpoint('process-stdin', {
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
каждую строку схемой, как в главе [12](../guide/12-files-and-streams.md), а
потоковый `output` транспорт писал бы в stdout тем же NDJSON.

```typescript
// src/errors.ts
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
printf "a\nb\n" | yarn start:dev process-stdin
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
// src/main.ts
const argv = process.argv.slice(2);

const cli = new CliTransport({
  mode: argv.length > 0 ? 'argv' : 'repl',
  argv,
});

const dispatch = makeDispatch([Help, Greet, Deploy, ProcessStdin]);

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

Потоки ввода, вывода и ошибок — тоже опции: `input`, `output` и
`errorOutput`. Умолчания — каналы процесса, а подстановка нужна тесту:
вопросы и печать результата проверяются без терминала.

Формы `events` и `multipart` транспорт отклоняет при регистрации.
Ошибка называет команду и форму: у команды нет соединения, обрыв
которого был бы нормальным завершением, а файлы приходят путями в
аргументах.

Пример собирает `dispatch` напрямую, потому что у команд нет
зависимостей. Команде с классом-хендлером нужен контейнер: объявите её в
фиче и объявите приложение через `makeApp` с транспортом `cli()` в
`transports:`. Минимальный пример — в [README
пакета](../../packages/nestling.transport.cli/README.ru.md).

## Проверка

Команды выполняются через `execute`: аргументы разбирает `parseArgv`,
ответ приходит значением, stdout в этом пути не участвует.

```typescript
// src/commands.spec.ts (фрагмент)
describe('команды через execute', () => {
  let cli: CliTransport;

  beforeEach(async () => {
    // Пустой `argv`: `serve` регистрирует команды и ничего не выполняет
    cli = new CliTransport({ mode: 'argv', argv: [] });
    await cli.serve(
      makeDispatch([Help, Greet, Deploy, ProcessStdin]),
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
    await expect(cli.execute(parseArgv(['release']))).rejects.toThrow(
      'Command "release" not found',
    );
  });
  // …
});
```

`parseArgv` собирает вход из массива строк по тем же правилам, что и
запуск из терминала. Команда, которой нет в `dispatch`, — не отказ
значением, а исключение с её именем: `execute` в этом случае не строит
контекст запроса.

Вопросы проверяются тем же `execute` с подставленными потоками. Ответы
передаются готовыми строками, а `interactive: true` включает вопросы явно:
подставленный поток терминалом не является.

```typescript
// src/commands.spec.ts (фрагмент)
const cli = new CliTransport({
  mode: 'argv',
  argv: [],
  input: answers('2\n', 'y\n', '\n'),
  output: collecting(printed),
  interactive: true,
});

await cli.serve(makeDispatch([Deploy]), new AbortController().signal);

const response = await cli.execute(parseArgv(['deploy']));

expect(response.value).toEqual({
  env: 'prod',
  host: 'localhost',
  forced: true,
});
```

```bash
yarn start:dev            # REPL
yarn test
```

Рецепт [«Зависимости по имени и сбор вкладов из
модулей»](./token-families.md) показывает семейства DI-токенов: один
рецепт на много зависимостей.
