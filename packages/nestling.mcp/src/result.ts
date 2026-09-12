/**
 * Отображение результата операции на результат вызова инструмента.
 *
 * Исходов два, и оба доходят до агента результатом вызова: успех и отказ.
 * Отказ ошибкой протокола не становится — объявленный отказ это часть
 * контракта операции, и агент должен его прочитать и учесть.
 */

import type { McpCallToolResult, McpContent } from './types.js';

import { InternalError, isFail, Ok } from '@nestlingjs/app';
import type { FailData } from '@nestlingjs/operations';

/** Текстовый элемент результата */
function text(value: string): McpContent[] {
  return [{ type: 'text', text: value }];
}

/** Объект ли значение: `structuredContent` держит только словарь */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Собирает результат успешного вызова.
 *
 * Значение уходит текстом JSON в `content` и, если у инструмента
 * объявлена схема выхода, ещё и в `structuredContent`. Два поля нужны
 * потому, что часть клиентов структурированный ответ не читает.
 *
 * @param value - Значение `Ok` операции
 * @param structured - Объявлена ли у инструмента схема выхода
 */
export function successResult(
  value: unknown,
  structured: boolean,
): McpCallToolResult {
  const body = JSON.stringify(value ?? null);

  return {
    content: text(body),
    ...(structured && isRecord(value) ? { structuredContent: value } : {}),
  };
}

/**
 * Собирает результат вызова, завершившегося отказом.
 *
 * Текст называет код и сообщение отказа, а `details` входят в тот же
 * текст. В `structuredContent` они не уходят: клиент проверяет это поле
 * объявленной схемой выхода, а отказ под неё не подходит.
 *
 * Необъявленная ошибка приходит из пайплайна отказом `internal_error` с
 * общим сообщением: текста исключения и стека в нём уже нет.
 *
 * @param fail - Отказ, вернувшийся из вызова порта
 */
export function failureResult(fail: FailData): McpCallToolResult {
  const body: Record<string, unknown> = {
    code: fail.code ?? InternalError.code,
    message: fail.message ?? 'Error',
  };

  if (fail.details !== undefined) {
    body.details = fail.details;
  }

  return { content: text(JSON.stringify(body)), isError: true };
}

/**
 * Переводит ответ порта в результат вызова инструмента.
 *
 * @param result - Ответ `port.call`: `Ok` или `Fail`
 * @param structured - Объявлена ли у инструмента схема выхода
 */
export function toCallToolResult(
  result: unknown,
  structured: boolean,
): McpCallToolResult {
  if (isFail(result)) {
    return failureResult(result);
  }

  return successResult(
    result instanceof Ok ? result.value : result,
    structured,
  );
}
