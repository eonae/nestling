/**
 * `ConsoleLogger` — реализация логгера по умолчанию.
 *
 * Единственное место ядра, которое пишет в поток процесса: каждая запись
 * уходит в `process.stderr` одной строкой. `stderr`, а не `stdout`: у
 * CLI-транспорта `stdout` занят результатом команды, и лог не должен в
 * него попадать.
 *
 * Класс не экспортируется из пакета: реализации ядра приватны, как у
 * конфига и портов. Наружу идут интерфейс, токены и ключи секции.
 */

import type { CtxReader } from '../pipeline/core/context/index.js';
import { Ctx, RequestId } from '../pipeline/core/context/index.js';

import type { LogConfig, LogFormat } from './config.js';
import { NestlingLogConfig } from './config.js';
import type { Fields, Logger, LogLevel, LogMethod } from './interface.js';

import { Injectable } from '@nestling/container';

/** Порядок уровней: запись ниже порога отбрасывается */
const RANK: Readonly<Record<LogLevel, number>> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/** Первый аргумент метода уровня: одна из трёх форм вызова */
type FirstArgument = string | Error | Fields;

/** Запись, разобранная из формы вызова */
interface Entry {
  readonly message?: string;
  readonly fields: Fields;
}

/**
 * Разбирает форму вызова.
 *
 * Ошибка первым аргументом даёт сообщение из `error.message` и саму
 * ошибку в `err`; поля второго аргумента не могут её перекрыть.
 */
function toEntry(first: FirstArgument, second?: Fields): Entry {
  if (typeof first === 'string') {
    return { message: first, fields: second ?? {} };
  }

  if (first instanceof Error) {
    return { message: first.message, fields: { ...second, err: first } };
  }

  return { fields: first };
}

/**
 * Сериализует ошибку полями: `name`, `message`, `stack`, `cause`.
 *
 * Значение, которое не является `Error`, отдаётся как есть: реализация
 * сериализует ключ `err` как ошибку, но не выдумывает её.
 */
function serializeError(err: unknown): unknown {
  if (!(err instanceof Error)) {
    return err;
  }

  const out: Record<string, unknown> = { name: err.name, message: err.message };

  if (err.stack) {
    out.stack = err.stack;
  }

  if (err.cause !== undefined) {
    out.cause = serializeError(err.cause);
  }

  return out;
}

/** Замена для значений, которые `JSON.stringify` не переносит */
const replacer = (_key: string, value: unknown): unknown =>
  typeof value === 'bigint' ? value.toString() : value;

/**
 * `JSON.stringify`, который не роняет запись.
 *
 * Циклическая ссылка в поле — ошибка вызывающего, но терять из-за неё
 * запись целиком нельзя: повторная встреча объекта помечается строкой.
 */
function toJson(value: unknown): string {
  try {
    return JSON.stringify(value, replacer);
  } catch {
    const seen = new WeakSet<object>();

    return JSON.stringify(value, (key, item: unknown) => {
      if (typeof item === 'object' && item !== null) {
        if (seen.has(item)) {
          return '[Circular]';
        }

        seen.add(item);
      }

      return replacer(key, item);
    });
  }
}

/** Значение поля в текстовом формате: скаляры как есть, объекты — JSON */
function formatValue(value: unknown): string {
  if (typeof value === 'string') {
    return value === '' || /[\s"=]/.test(value) ? JSON.stringify(value) : value;
  }

  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }

  if (value === undefined) {
    return 'undefined';
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return toJson(value);
}

/**
 * Ошибка в текстовом формате: `<name>: <message>`, стек на следующих
 * строках, причина — после стека.
 */
function formatError(err: unknown): string {
  if (!(err instanceof Error)) {
    return formatValue(err);
  }

  // Первая строка стека Node — это `name: message`; она уже напечатана
  const stackLines = err.stack?.split('\n').slice(1) ?? [];
  let out = `${err.name}: ${err.message}`;

  for (const line of stackLines) {
    out += `\n${line}`;
  }

  if (err.cause !== undefined) {
    out += `\n    caused by: ${formatError(err.cause)}`;
  }

  return out;
}

/**
 * Логгер по умолчанию: уровень и формат из секции `nestlingLog`,
 * идентификатор запроса из контекста, записи в `process.stderr`.
 *
 * - `text`: `<время ISO> <УРОВЕНЬ> <scope> <сообщение> key=value …`;
 *   значения-объекты через `JSON.stringify`; `err` — `err=<name>: <message>`
 *   и стек на следующих строках.
 * - `json`: одна строка с полями `time`, `level`, привязками, `requestId`,
 *   `msg`, полями вызова и `err` в виде `{ name, message, stack, cause? }`.
 *
 * `requestId` читается из `Ctx(RequestId)` в момент записи и добавляется
 * полем, если он есть и поле не задано вызовом. Вне запроса поля нет.
 */
@Injectable([NestlingLogConfig, Ctx(RequestId)])
export class ConsoleLogger implements Logger {
  readonly #config: LogConfig;
  readonly #requestId: CtxReader<string> | undefined;
  readonly #bindings: Fields;
  readonly #threshold: number;
  readonly #format: LogFormat;

  constructor(
    config: LogConfig,
    requestId?: CtxReader<string>,
    bindings: Fields = {},
  ) {
    this.#config = config;
    this.#requestId = requestId;
    this.#bindings = bindings;
    this.#threshold = RANK[config.level];
    this.#format = config.format;
  }

  readonly debug: LogMethod = (first: FirstArgument, second?: Fields): void =>
    this.#write('debug', first, second);

  readonly info: LogMethod = (first: FirstArgument, second?: Fields): void =>
    this.#write('info', first, second);

  readonly warn: LogMethod = (first: FirstArgument, second?: Fields): void =>
    this.#write('warn', first, second);

  readonly error: LogMethod = (first: FirstArgument, second?: Fields): void =>
    this.#write('error', first, second);

  /** Дочерний логгер с теми же секцией и ридером и объединёнными привязками */
  child(bindings: Fields): Logger {
    return new ConsoleLogger(this.#config, this.#requestId, {
      ...this.#bindings,
      ...bindings,
    });
  }

  #write(level: LogLevel, first: FirstArgument, second?: Fields): void {
    if (RANK[level] < this.#threshold) {
      return;
    }

    const { message, fields } = toEntry(first, second);
    const { err, ...rest } = fields;

    // Порядок полей и есть порядок в строке: время, уровень, привязки
    // (`scope` среди них), идентификатор запроса, сообщение, поля, ошибка
    const data: Record<string, unknown> = { ...this.#bindings };

    const requestId = this.#requestId?.peek();
    if (
      requestId !== undefined &&
      !('requestId' in rest) &&
      !('requestId' in data)
    ) {
      data.requestId = requestId;
    }

    Object.assign(data, rest);

    const time = new Date().toISOString();
    const line =
      this.#format === 'json'
        ? formatJson(time, level, message, data, 'err' in fields, err)
        : formatText(time, level, message, data, 'err' in fields, err);

    process.stderr.write(`${line}\n`);
  }
}

/** Строка формата `json` */
function formatJson(
  time: string,
  level: LogLevel,
  message: string | undefined,
  data: Record<string, unknown>,
  hasError: boolean,
  err: unknown,
): string {
  const { scope, ...bindingsAndFields } = data;
  const record: Record<string, unknown> = { time, level };

  if (scope !== undefined) {
    record.scope = scope;
  }

  // Сообщение стоит после привязок и перед полями вызова; привязки и поля
  // здесь уже слиты в `data`, и разделять их обратно незачем: порядок
  // ключей важен читателю, а не парсеру
  if (message !== undefined) {
    record.msg = message;
  }

  Object.assign(record, bindingsAndFields);

  if (hasError) {
    record.err = serializeError(err);
  }

  return toJson(record);
}

/** Строка формата `text` */
function formatText(
  time: string,
  level: LogLevel,
  message: string | undefined,
  data: Record<string, unknown>,
  hasError: boolean,
  err: unknown,
): string {
  const { scope, ...rest } = data;
  const parts = [time, level.toUpperCase().padEnd(5)];

  if (scope !== undefined) {
    parts.push(String(scope));
  }

  if (message !== undefined) {
    parts.push(message);
  }

  for (const [key, value] of Object.entries(rest)) {
    parts.push(`${key}=${formatValue(value)}`);
  }

  if (hasError) {
    parts.push(`err=${formatError(err)}`);
  }

  return parts.join(' ');
}

/**
 * Логгер для standalone-путей без `App`: `makeDispatch`, `new InProcessBus()`.
 *
 * Без секции и ридера: уровень `info`, формат `text`, без `requestId`.
 * Правило «незадекларированный отказ не проглатывается молча» держится на
 * нём. Из пакета не экспортируется.
 */
export const defaultLogger: Logger = new ConsoleLogger({
  level: 'info',
  format: 'text',
});
