/**
 * Копилка нарушений объявления — сообщает их **одним списком**.
 *
 * Приложение не чинит инструменты по одному за прогон. Если описания нет у
 * двух, а схема третьего не переводится, оно узнаёт про все три сразу — тем
 * же приёмом, которым копит нарушения генератор OpenAPI.
 *
 * Нарушения бросаются в `serve`, до того как сервер откроет сокет: старт
 * идёт шагами, и `listen` — последний из них.
 */

/** Одно нарушение: где оно и в чём состоит */
export interface McpViolation {
  /** Инструмент: `tool 'users_create'` */
  readonly where: string;

  /** Суть нарушения и способ починки — хвост строки диагностики */
  readonly detail: string;
}

/** Копилка нарушений одного старта */
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
      `${this.#violations.length} problem(s) in tools declared on the MCP ` +
        `transport:\n\n` +
        `${lines}\n\n` +
        `Every tool declared on the MCP transport must carry a description ` +
        `the agent can choose it by and an object input schema. Fix each ` +
        `one, or move the declaration to another transport.`,
    );
  }
}

/** Координаты инструмента для текста диагностики */
export function whereOf(toolName: string): string {
  return `tool '${toolName}'`;
}
