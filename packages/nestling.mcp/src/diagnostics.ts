/**
 * Копилка нарушений объявления — сообщает их **одним списком**.
 *
 * Приложение не чинит инструменты по одному за прогон. Если описания нет у
 * двух, а схема третьего не переводится, оно узнаёт про все три сразу — тем
 * же приёмом, которым копит нарушения генератор OpenAPI.
 *
 * Нарушения бросаются на фазе ASSEMBLE, до INIT и до открытия сокета:
 * определения строит провайдер жадного контейнера, поэтому отдельного кода
 * для этой гарантии не нужно.
 */

/** Одно нарушение: где оно и в чём состоит */
export interface McpViolation {
  /** Инструмент: `tool 'users_create' (operation 'users.create')` */
  readonly where: string;

  /** Суть нарушения и способ починки — хвост строки диагностики */
  readonly detail: string;
}

/** Копилка нарушений одной сборки */
export class McpDiagnostics {
  readonly #violations: McpViolation[] = [];

  add(where: string, detail: string): void {
    this.#violations.push({ where, detail });
  }

  get violations(): readonly McpViolation[] {
    return this.#violations;
  }

  /**
   * Бросает одним сообщением, если нарушения есть.
   *
   * @throws {Error} Перечисление всех нарушений с координатами инструментов
   */
  throwIfAny(): void {
    if (this.#violations.length === 0) {
      return;
    }

    const lines = this.#violations
      .map(({ where, detail }) => `  - ${where}: ${detail}`)
      .join('\n');

    throw new Error(
      `${this.#violations.length} tool(s) cannot be exposed over MCP:\n\n` +
        `${lines}\n\n` +
        `Every tool in 'tools:' must carry a name the protocol accepts, a ` +
        `description the agent can choose it by, and an object input ` +
        `schema. Fix each one, or drop it from the list.`,
    );
  }
}

/** Координаты инструмента для текста диагностики */
export function whereOf(toolName: string, operationName: string): string {
  return `tool '${toolName}' (operation '${operationName}')`;
}
