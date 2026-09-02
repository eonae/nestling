/**
 * Секция `doc`: метаданные операции, которых нет в схемах.
 *
 * Схема описывает форму данных, а не операцию: как её назвать в списке, к
 * какой группе отнести, каким статусом отвечает успех, показывать ли её
 * наружу. Всё это объявляется в одной секции `doc`.
 *
 * Секция не зависит от транспорта (живёт на `EndpointOptions` и
 * `OperationSpec`; ядро её не интерпретирует) и от формата документации
 * (полей, осмысленных только для OpenAPI, в ней нет; `operationId`
 * выводится, а не объявляется).
 *
 * Проверка `assertDoc` одна; её вызывают `makeEndpoint` и `makeRequest`.
 */

import type { SuccessStatus } from './status.js';
import { successStatuses } from './status.js';

/**
 * Документация операции.
 *
 * Каждое поле опционально. Пустой `doc: {}` допустим и означает «ничего не
 * объявлено».
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
   * Статус успешного ответа из перечня `successStatuses`.
   *
   * По умолчанию `OK`; у endpoint'а без `output` — `NO_CONTENT`. С тем, что
   * возвращает хендлер, значение не сверяется: успешный статус не выражен
   * типом (открытый вопрос в `deferred.md`).
   */
  readonly status?: SuccessStatus;

  /**
   * Причина, по которой операция не попадает в документацию.
   *
   * Только строка, как у `detached`: отказ от документирования должен быть
   * виден в диффе. Формы `hidden: true` нет ни в типах, ни в рантайме.
   */
  readonly hidden?: string;
}

/** Поля секции; этот же список печатает текст ошибки */
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
 * Проверяет секцию `doc` при создании декларации или операции.
 *
 * Типы отсекают большинство ошибок, но из JS проверка типов недоступна.
 * Без рантайм-проверки `hidden: true` молча убрал бы endpoint из
 * документа, а неизвестное поле молча игнорировалось бы.
 *
 * @param doc - Значение секции
 * @param where - Как назвать владельца в тексте ошибки: `Endpoint 'GET /x'`
 * или `Operation 'users.create'`
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
          `The operation name is derived from the operation name (or from the ` +
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
