/**
 * Статусы успеха и категории отказов.
 *
 * Оба перечня закрыты и не зависят от транспорта. В код провода их
 * переводит транспорт: HTTP берёт число из своей таблицы, шина несёт
 * статус как есть.
 */

/** Статусы успешного ответа (`Ok`) */
export const successStatuses = [
  'ok', // 200
  'created', // 201
  'accepted', // 202
  'no_content', // 204
] as const;

/**
 * Категории отказов: первый сегмент кода отказа.
 *
 * Категория говорит, как отвечать. Уточнение кода после двоеточия говорит,
 * что случилось. В HTTP-код категорию переводит `STATUS_MAP` в
 * `@nestling/transport.http`.
 */
export const categories = [
  'bad_request', // 400
  'unauthorized', // 401
  'payment_required', // 402
  'forbidden', // 403
  'not_found', // 404
  'conflict', // 409
  // Вход больше допустимого: лимит тела, item-цепочки, файл сверх upload({ maxSize })
  'payload_too_large', // 413
  'too_many_requests', // 429
  'internal_error', // 500
  'not_implemented', // 501
  'service_unavailable', // 503
  // Операция не уложилась в срок (бюджет вызова порта, молчание потока).
  // Это 504, а не 408: 408 означает, что клиент не дослал запрос.
  'timeout', // 504
] as const;

/** Все статусы контекста ответа: успех либо категория отказа */
export const statuses = [...successStatuses, ...categories] as const;

export type SuccessStatus = (typeof successStatuses)[number];
export type Category = (typeof categories)[number];
export type ProcessingStatus = SuccessStatus | Category;

/**
 * Код отказа: категория, за которой могут идти уточняющие сегменты через
 * двоеточие. Категорию проверяет компилятор, формат сегментов — рантайм
 * в `makeFail`.
 *
 * @example
 * ```typescript
 * 'not_found:user'
 * 'conflict:email_taken'
 * 'unauthorized'
 * ```
 */
export type FailCode = Category | `${Category}:${string}`;

/** Формат одного сегмента кода */
const SEGMENT = /^[_a-z]+$/;

/** Проверяет, что строка — категория из перечня */
export function isCategory(value: unknown): value is Category {
  return (
    typeof value === 'string' &&
    (categories as readonly string[]).includes(value)
  );
}

/**
 * Категория по коду: первый сегмент.
 *
 * Код без двоеточия — сама категория. Функция не проверяет формат: её
 * зовут там, где код уже принят (`makeFail`) или пришёл с провода.
 */
export function categoryOf(code: string): Category {
  const separator = code.indexOf(':');

  return (separator === -1 ? code : code.slice(0, separator)) as Category;
}

/**
 * Проверяет формат кода отказа: сегменты через двоеточие, каждый по
 * `[a-z_]+`, первый — категория из перечня.
 *
 * @param code - Код отказа
 * @param where - Кто проверяет; попадает в текст ошибки
 * @throws {TypeError} Код не строка
 * @throws {Error} Сегмент вне алфавита или категория вне перечня; текст
 * называет код и позицию сегмента
 */
export function assertFailCode(
  code: unknown,
  where: string,
): asserts code is FailCode {
  if (typeof code !== 'string' || code.length === 0) {
    throw new TypeError(
      `${where}: the code must be a non-empty string of the form ` +
        `'<category>' or '<category>:<detail>'.`,
    );
  }

  const segments = code.split(':');

  for (const [index, segment] of segments.entries()) {
    if (!SEGMENT.test(segment)) {
      throw new Error(
        `${where}: code '${code}' has segment ${index + 1} '${segment}' ` +
          `that does not match [a-z_]+. Segments are lower-case words ` +
          `separated by ':'.`,
      );
    }
  }

  if (!isCategory(segments[0])) {
    throw new Error(
      `${where}: code '${code}' starts with '${segments[0]}', which is not ` +
        `a category. Categories: ${categories.join(', ')}.`,
    );
  }
}
