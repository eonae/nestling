/**
 * Разбор командной строки по схеме декларации.
 *
 * Схема флагов выводится из декларации целиком: `--features` и
 * `--include-deps` отвечают полям объектной формы, по флагу приходится на
 * каждый переключатель `switches:`, `--help` есть всегда. Своего разбора
 * точка входа не пишет.
 *
 * Модуль чистый: он ничего не печатает и процесс не завершает. Печать
 * справки и выход делает `parseArgs` — тремя строками на границе, а текст
 * отказа и текст справки проверяются тестом целиком.
 */

import type { ParsedArgs } from './args.js';

import type { AnySwitch } from '@nestlingjs/container';

/** Схема аргументов: то, что разбор знает о декларации */
export interface CommandLineSpec {
  /** Имена объявленных фич — значения `--features` и строка справки */
  readonly features: readonly string[];

  /** Переключатели корня: по флагу на каждый */
  readonly switches: readonly AnySwitch[];
}

/** Исход разбора: аргумент сборки либо готовый текст справки */
export type CommandLine =
  | { readonly help: false; readonly parsed: ParsedArgs }
  | { readonly help: true; readonly text: string };

/** Флаг замыкания выбора: имя в командной строке */
const INCLUDE_DEPS_FLAG = '--include-deps';

/** Перечень известных флагов — им заканчивается сообщение об отказе */
const knownFlags = (spec: CommandLineSpec): string =>
  [
    '--features',
    INCLUDE_DEPS_FLAG,
    ...spec.switches.map(({ name }) => `--${name}`),
    '--help',
  ].join(', ');

/** Значения переключателя в кавычках, через запятую */
const valuesOf = (declared: AnySwitch): string =>
  declared.values.map((value: string) => `'${value}'`).join(', ');

/** Объявленные фичи для сообщений; их может не быть вовсе */
const featuresOf = (spec: CommandLineSpec): string =>
  spec.features.length > 0 ? spec.features.join(', ') : 'none declared';

/**
 * Строит текст справки по схеме декларации.
 *
 * Функция чистая: текст проверяется тестом без завершения процесса.
 *
 * @param script - Путь к скрипту — второй элемент маркера
 * @param spec - Схема аргументов декларации
 * @returns Готовый текст с завершающим переводом строки
 */
export function helpText(script: string, spec: CommandLineSpec): string {
  const rows: readonly (readonly [string, string])[] = [
    ['--features <all|name,…>', `Features to build. Default: all`],
    [INCLUDE_DEPS_FLAG, 'Add features whose operations the selection calls'],
    ...spec.switches.map(
      (declared) =>
        [
          `--${declared.name} <${declared.values.join('|')}>`,
          declared.default === undefined
            ? 'Required: the switch has no default'
            : `Default: ${declared.default as string}`,
        ] as const,
    ),
    ['--help', 'Print this schema and exit'],
  ];

  const width = Math.max(...rows.map(([flag]) => flag.length));

  return [
    `Usage: node ${script} [options]`,
    '',
    `Features: ${featuresOf(spec)}`,
    '',
    'Options:',
    ...rows.map(([flag, note]) => `  ${flag.padEnd(width)}  ${note}`),
    '',
  ].join('\n');
}

/**
 * Читает значение флага: запись `--name value` и запись `--name=value`.
 *
 * Следующий элемент со своим ведущим дефисом значением не считается:
 * `--storage --features users` — это забытое значение, а не значение
 * `--features`.
 */
function readValue(
  rest: readonly string[],
  index: number,
  inline: string | undefined,
): { readonly value: string | undefined; readonly next: number } {
  if (inline !== undefined) {
    return { value: inline, next: index };
  }

  const ahead = rest[index + 1];

  return ahead === undefined || ahead.startsWith('-')
    ? { value: undefined, next: index }
    : { value: ahead, next: index + 1 };
}

/**
 * Разбирает командную строку в аргумент сборки.
 *
 * Первые два элемента отбрасываются: маркер несёт `process.argv` целиком.
 * `--help` проверяется до всего остального — попросивший справку получает
 * её, даже если ошибся в соседнем флаге.
 *
 * Разбор отвечает за форму: неизвестный флаг, пропущенное значение,
 * значение вне словаря переключателя и позиционный аргумент. Неизвестное
 * имя фичи ловит разрешение выбора: список объявленных фич знает оно.
 *
 * @param strings - Список маркера — `process.argv` целиком
 * @param spec - Схема аргументов декларации
 * @returns Разобранный аргумент либо текст справки
 * @throws {Error} Командная строка не разобрана
 */
export function parseCommandLine(
  strings: readonly string[],
  spec: CommandLineSpec,
): CommandLine {
  const rest = strings.slice(2);

  if (rest.includes('--help')) {
    return { help: true, text: helpText(strings[1] ?? 'main.js', spec) };
  }

  const declared = new Map(spec.switches.map((item) => [item.name, item]));
  const given: Record<string, string> = {};

  let features: string | undefined;
  let includeDeps = false;

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index] as string;

    if (!token.startsWith('--')) {
      throw new Error(
        `Unexpected argument '${token}'. The build argument takes flags ` +
          `only: every value belongs to one. Known flags: ${knownFlags(spec)}.`,
      );
    }

    const split = token.indexOf('=');
    const name = split === -1 ? token.slice(2) : token.slice(2, split);
    const inline = split === -1 ? undefined : token.slice(split + 1);

    if (name === 'include-deps') {
      if (inline !== undefined) {
        throw new Error(
          `Flag '${INCLUDE_DEPS_FLAG}' takes no value, got '${inline}'. It ` +
            `either closes the selection over called operations or does not: ` +
            `pass it bare.`,
        );
      }

      includeDeps = true;
      continue;
    }

    if (name === 'features') {
      const read = readValue(rest, index, inline);

      if (read.value === undefined) {
        throw new Error(
          `Flag '--features' needs a value: 'all' or feature names ` +
            `separated by commas. Declared features: ${featuresOf(spec)}.`,
        );
      }

      features = read.value;
      index = read.next;
      continue;
    }

    const declaredSwitch = declared.get(name);

    if (!declaredSwitch) {
      throw new Error(
        `Unknown flag '--${name}'. Known flags: ${knownFlags(spec)}.`,
      );
    }

    const read = readValue(rest, index, inline);

    if (read.value === undefined) {
      throw new Error(
        `Flag '--${name}' needs a value. Allowed values: ` +
          `${valuesOf(declaredSwitch)}.`,
      );
    }

    if (!(declaredSwitch.values as readonly string[]).includes(read.value)) {
      throw new Error(
        `Switch '${name}' has no value '${read.value}'. Allowed values: ` +
          `${valuesOf(declaredSwitch)}.`,
      );
    }

    given[name] = read.value;
    index = read.next;
  }

  for (const item of spec.switches) {
    if (item.default === undefined && given[item.name] === undefined) {
      throw new Error(
        `Switch '${item.name}' has no default, and the command line does ` +
          `not set it. Pass the flag: '--${item.name} ` +
          `${item.values[0] as string}'. Allowed values: ${valuesOf(item)}.`,
      );
    }
  }

  return {
    help: false,
    parsed: {
      ...(features === undefined ? {} : { features }),
      includeDeps,
      given,
    },
  };
}
