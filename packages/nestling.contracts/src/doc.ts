/**
 * Слот `doc:` — единственный источник метаданных, которых нет в схемах.
 *
 * JSON Schema описывает форму данных и ничего не говорит о самой операции:
 * как её назвать в списке, к какой группе отнести, каким статусом отвечает
 * успех, стоит ли её вообще показывать наружу. Всё это объявляется здесь —
 * одной секцией, а не россыпью полей по словарю декларации.
 *
 * Два свойства слота обязательны и держатся этим модулем:
 *
 * - **транспорт-нейтральность**: слот живёт на `EndpointOptions` ядра и на
 *   `ContractSpec`, а не в HTTP-словаре; ядро его переносит и не
 *   интерпретирует — ровно как `binding`;
 * - **формат-нейтральность**: полей, осмысленных только для OpenAPI
 *   (`operationId`, `externalDocs`, `servers`), в нём нет — тот же слот
 *   читает будущая генерация AsyncAPI. `operationId` поэтому **выводится**,
 *   а не объявляется.
 *
 * Реализация проверки одна, мест вызова два (`makeEndpoint` и
 * `makeContract`) — тем же приёмом, которым живёт `computeHttpBinding`:
 * правило одно, адресат жалобы разный.
 */

import type { SuccessStatus } from './status.js';
import { successStatuses } from './status.js';

/**
 * Документация операции: то, чего в схемах нет в принципе.
 *
 * Каждое поле опционально; секции без единого поля не существует — пустой
 * `doc: {}` легален и означает «ничего не объявлено».
 */
export interface DeclarationDoc {
  /** Однострочное название операции */
  readonly summary?: string;

  /** Развёрнутое описание */
  readonly description?: string;

  /** Группировка операции */
  readonly tags?: readonly string[];

  /** Операция объявлена устаревшей */
  readonly deprecated?: boolean;

  /**
   * Статус успешного ответа из словаря статусов ядра.
   *
   * По умолчанию `OK`, а у ручки без `output` — `NO_CONTENT`. Значение
   * никем не сверяется с тем, что реально возвращает хендлер: успешный
   * статус в V1 типом не выражен (открытый вопрос в `deferred.md`).
   */
  readonly status?: SuccessStatus;

  /**
   * Причина, по которой операция не попадает в документацию.
   *
   * Строка, а не флаг, — прямая калька с `detached`: тотальный opt-out
   * обязан быть читаем в diff'е. Формы `hidden: true` не существует ни в
   * типах, ни в рантайме.
   */
  readonly hidden?: string;
}

/** Поля секции, перечисленные значением: их же печатает текст ошибки */
const DOC_FIELDS = [
  'summary',
  'description',
  'tags',
  'deprecated',
  'status',
  'hidden',
] as const;

/** Поля-строки: проверяются одинаково */
const DOC_STRINGS = ['summary', 'description'] as const;

/**
 * Fail-fast словаря `doc` — **в момент создания значения**.
 *
 * Типы отсекают почти всё перечисленное, но JS-потребителей типы не
 * сдерживают, а цена молчания здесь высокая: тихо проигнорированный
 * `hidden: true` убрал бы ручку из документа, не оставив в коде ни строчки
 * о том, почему, а неизвестное поле выглядело бы как «написал и не
 * работает».
 *
 * @param doc - Значение секции из словаря носителя
 * @param where - Как назвать носителя в тексте ошибки: `Endpoint 'GET /x'`
 * либо `Contract 'users.create'`
 * @throws {TypeError} Дефектная форма поля или неизвестное поле секции
 * @throws {Error} Пустая причина `hidden` или статус вне словаря
 */
export function assertDoc(
  doc: unknown,
  where: string,
): asserts doc is DeclarationDoc | undefined {
  if (doc === undefined) {
    return;
  }

  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    throw new TypeError(
      `${where}: 'doc' must be a section object with any of ` +
        `${DOC_FIELDS.map((field) => `'${field}'`).join(', ')}.`,
    );
  }

  const section = doc as Record<string, unknown>;

  for (const field of Object.keys(section)) {
    if (!(DOC_FIELDS as readonly string[]).includes(field)) {
      throw new TypeError(
        `${where}: 'doc.${field}' is not a field of the documentation ` +
          `section. Known fields: ` +
          `${DOC_FIELDS.map((known) => `'${known}'`).join(', ')}. ` +
          `The operation name is derived from the contract name (or from the ` +
          `method and path), not declared.`,
      );
    }
  }

  for (const field of DOC_STRINGS) {
    const value = section[field];
    if (value !== undefined && typeof value !== 'string') {
      throw new TypeError(`${where}: 'doc.${field}' must be a string.`);
    }
  }

  const { tags } = section;
  if (
    tags !== undefined &&
    (!Array.isArray(tags) ||
      tags.some((tag) => typeof tag !== 'string' || tag.length === 0))
  ) {
    throw new TypeError(
      `${where}: 'doc.tags' must be an array of non-empty strings.`,
    );
  }

  const { deprecated } = section;
  if (deprecated !== undefined && typeof deprecated !== 'boolean') {
    throw new TypeError(`${where}: 'doc.deprecated' must be a boolean.`);
  }

  const { status } = section;
  if (
    status !== undefined &&
    !(successStatuses as readonly string[]).includes(status as string)
  ) {
    throw new Error(
      `${where}: 'doc.status' must be one of ` +
        `${successStatuses.map((known) => `'${known}'`).join(', ')}, got ` +
        `${JSON.stringify(status)}. The slot declares the status of a ` +
        `**successful** response; failures carry their own status in ` +
        `defineFail(...).`,
    );
  }

  const { hidden } = section;
  if (hidden !== undefined) {
    if (typeof hidden !== 'string') {
      throw new TypeError(
        `${where}: 'doc.hidden' must be a non-empty string — the reason this ` +
          `operation stays out of the documentation. There is no ` +
          `'hidden: true'.`,
      );
    }

    if (hidden.trim().length === 0) {
      throw new Error(
        `${where}: 'doc.hidden' must state a reason; an empty string hides ` +
          `the operation from every consumer without saying why.`,
      );
    }
  }
}
