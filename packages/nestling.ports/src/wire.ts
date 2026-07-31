/**
 * Симуляция провода: структурная копия значения.
 *
 * Копия — не оптимизация и не защита от мутаций, а **репетиция**: то, что
 * не переживает `structuredClone`, не переживёт и сериализацию в момент,
 * когда фичи разъедутся по процессам. Поэтому отказ здесь внятный и
 * называет поле, а не «DataCloneError» из недр рантайма.
 */

/**
 * Значение не переживает провод.
 *
 * Отдельный класс, потому что это единственная ошибка remote-пути, за
 * которую отвечает **вызывающий**: она возвращается ему отказом
 * валидации, а не превращается в `UnknownError` наравне с отказами
 * обработчика.
 */
export class WireCopyError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'WireCopyError';
  }
}

/**
 * Ищет поле верхнего уровня, из-за которого клонирование не удалось.
 *
 * Перебор, а не разбор сообщения рантайма: текст `DataCloneError`
 * различается между движками, а имя поля автору нужно всегда.
 */
function findUncloneableField(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  for (const [key, item] of Object.entries(value)) {
    try {
      structuredClone(item);
    } catch {
      return key;
    }
  }

  return undefined;
}

/**
 * Копирует значение так, как его скопировал бы провод.
 *
 * @param value - Payload вызова или тело ответа
 * @param where - Что копируется: текст едет в ошибку целиком
 * @throws {Error} Если значение не переживает структурное копирование
 */
export function structuralCopy<T>(value: T, where: string): T {
  try {
    return structuredClone(value);
  } catch (error) {
    const field = findUncloneableField(value);

    throw new WireCopyError(
      `${where}: ${field === undefined ? 'the value' : `field '${field}'`} ` +
        `cannot be structurally cloned, so it would not survive the wire. ` +
        `Contract payloads must be plain data (no functions, class ` +
        `instances with behaviour, streams or sockets).`,
      { cause: error },
    );
  }
}
