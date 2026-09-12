/**
 * Типы определения инструмента и результата его вызова.
 *
 * Пакет объявляет их сам, а не импортирует из `@modelcontextprotocol/sdk`:
 * SDK стоит в `devDependencies` и в рантайм не попадает. Совпадение с
 * протоколом держит `mcp.type-test.ts` — он присваивает эти типы `Tool` и
 * `CallToolResult` из SDK, и расхождение становится ошибкой компиляции.
 *
 * Массивы и словари объявлены изменяемыми. Читаемый только на чтение
 * массив типу SDK не присваивается, и `readonly` здесь стоил бы той самой
 * сверки, ради которой типы и объявлены.
 */

/** JSON-значение: всё, что переживает `JSON.parse(JSON.stringify(...))` */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * Объектная JSON Schema — форма, которую протокол требует от `inputSchema`
 * и `outputSchema`.
 *
 * Остальные ключи схемы переносятся как есть: их даёт конвертер вендора,
 * и описывать их своим типом значило бы притворяться, что пакет понимает
 * их устройство.
 */
export interface McpObjectSchema {
  type: 'object';
  properties?: Record<string, object>;
  required?: string[];
  [key: string]: unknown;
}

/**
 * Подсказки агенту о характере инструмента.
 *
 * Значения объявляет автор: из декларации операции они не выводятся.
 * HTTP-метод сказал бы про эффект неправду — `POST /users/search` меняет
 * данные не больше, чем `GET`.
 */
export interface McpToolAnnotations {
  /** Заголовок для показа пользователю */
  title?: string;

  /** Инструмент не меняет данные */
  readOnlyHint?: boolean;

  /** Повторный вызов с теми же аргументами меняет данные ещё раз */
  destructiveHint?: boolean;

  /** Повторный вызов с теми же аргументами ничего не добавляет */
  idempotentHint?: boolean;

  /** Инструмент обращается к внешнему миру, а не к замкнутому набору данных */
  openWorldHint?: boolean;
}

/** Определение инструмента: то, что уходит агенту в ответе `tools/list` */
export interface McpToolDefinition {
  /** Имя инструмента: `[a-zA-Z0-9_-]{1,128}` */
  name: string;

  /** Описание для агента; по нему он выбирает инструмент */
  description?: string;

  /** Схема аргументов вызова */
  inputSchema: McpObjectSchema;

  /**
   * Схема успешного результата.
   *
   * Объявляется только у инструмента, выход которого переводится в
   * объектную JSON Schema: клиент проверяет по ней `structuredContent`.
   */
  outputSchema?: McpObjectSchema;

  /** Подсказки о характере инструмента */
  annotations?: McpToolAnnotations;
}

/** Текстовый элемент результата: единственный вид, который отдаёт пакет */
export interface McpTextContent {
  type: 'text';
  text: string;
}

/** Элемент результата вызова инструмента */
export type McpContent = McpTextContent;

/**
 * Результат вызова инструмента: успех операции или её отказ.
 *
 * Индексная сигнатура объявлена потому, что её требует протокол: результат
 * любого метода несёт `_meta` и разрешает поля сверх объявленных.
 */
export interface McpCallToolResult {
  [key: string]: unknown;

  /** Результат текстом; его читают клиенты, не разбирающие `structuredContent` */
  content: McpContent[];

  /**
   * Успешное значение выхода.
   *
   * Есть только у успеха и только у инструмента с `outputSchema`: клиент
   * проверяет поле этой схемой, и отказ операции под неё не подходит.
   */
  structuredContent?: Record<string, unknown>;

  /** Вызов завершился отказом операции */
  isError?: boolean;
}

/** Сведения о сервере: то, что `initialize` возвращает клиенту */
export interface McpServerInfo {
  /** Имя сервера; агент показывает его пользователю */
  name: string;

  /** Версия сервера */
  version: string;

  /** Заголовок для показа пользователю */
  title?: string;
}
