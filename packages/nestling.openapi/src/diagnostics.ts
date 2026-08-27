/**
 * Диагностики построения документа — **тотальные**.
 *
 * Чинить по одной ручке за прогон не режим работы: приложение, в котором
 * непокрытых конвертером схем три, обязано сказать про все три сразу. Тот
 * же приём, которым `App` копит нарушения политик.
 *
 * Собранные нарушения уезжают одним броском на фазе 1 ASSEMBLE — до
 * `@OnInit` и до открытия сокета: документ строится провайдером жадного
 * контейнера, и отдельного кода для boot-time-гарантии не нужно.
 */

/** Одно нарушение: где оно и в чём состоит */
export interface OpenApiViolation {
  /** Ручка: `'POST /api/users' (module 'module:users')` */
  readonly where: string;

  /** Суть нарушения и способ починки — хвост строки диагностики */
  readonly detail: string;
}

/** Копилка нарушений одного построения */
export class Diagnostics {
  readonly #violations: OpenApiViolation[] = [];

  add(where: string, detail: string): void {
    this.#violations.push({ where, detail });
  }

  get violations(): readonly OpenApiViolation[] {
    return this.#violations;
  }

  /**
   * Бросает одним сообщением, если нарушения есть.
   *
   * @throws {Error} Перечисление всех нарушений с координатами ручек
   */
  throwIfAny(): void {
    if (this.#violations.length === 0) {
      return;
    }

    const lines = this.#violations
      .map(({ where, detail }) => `  - ${where}: ${detail}`)
      .join('\n');

    throw new Error(
      `${this.#violations.length} endpoint(s) cannot be documented:\n\n` +
        `${lines}\n\n` +
        `Every HTTP handle of the application must be documentable while ` +
        `documentation is enabled. Fix each one, or leave it out ` +
        `deliberately with doc: { hidden: '<reason>' } in its declaration.`,
    );
  }
}

/** Координаты ручки для текста диагностики */
export function whereOf(pattern: string, moduleName: string): string {
  return `'${pattern}' (module '${moduleName}')`;
}
