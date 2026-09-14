/**
 * Отображение исхода пайплайна на результат вызова инструмента.
 *
 * Исходов два, и оба доходят до агента результатом вызова: успех и отказ.
 * Отказ ошибкой протокола не становится — объявленный отказ это часть
 * контракта операции, и агент должен его прочитать и учесть.
 */

import type { McpCallToolResult, McpContent } from './types.js';

import type { ErrorDetails, ResponseContext } from '@nestlingjs/app';

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
 * @param value - Значение успешного ответа
 * @param structured - Объявлена ли у инструмента схема выхода
 */
export function successResult(
  value: unknown,
  structured: boolean,
): McpCallToolResult {
  const content = text(JSON.stringify(value ?? null));

  // Условие составное, и примесью его не записать: вызов предиката
  // синтаксически небулев, а `conditional-spread` читает форму, не тип
  return structured && isRecord(value)
    ? { content, structuredContent: value }
    : { content };
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
 * @param error - Детали отказа из контекста ответа
 */
export function failureResult(error: ErrorDetails): McpCallToolResult {
  const body: Record<string, unknown> = {
    code: error.code,
    message: error.error,
  };

  if (error.details !== undefined) {
    body.details = error.details;
  }

  return { content: text(JSON.stringify(body)), isError: true };
}

/**
 * Переводит контекст ответа в результат вызова инструмента.
 *
 * @param response - Исход `dispatch.call`: успех или отказ
 * @param structured - Объявлена ли у инструмента схема выхода
 */
export function toCallToolResult(
  response: ResponseContext,
  structured: boolean,
): McpCallToolResult {
  return response.isSuccess
    ? successResult(response.value, structured)
    : failureResult(response.value);
}
