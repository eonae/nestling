import { observability } from '../modules/logger';
import { UserNotDeletable } from '../modules/users/user.errors';

import { compose, makePipeline, validate } from '@nestling/pipeline';

/**
 * Внутренний слой: валидация payload.
 *
 * `makePipeline<{ requestId: string }>()` объявляет требование к внешнему
 * контексту — компилятор проверяет его в точке композиции.
 */
const validation = makePipeline<{ requestId: string }>().pre(validate());

/**
 * Базовый pipeline с валидацией
 *
 * ✅ Содержит validate() - можно использовать с endpoint'ами, у которых есть input схема
 *
 * Внешний слой приезжает от инфра-модуля логирования: сквозное поведение
 * композируется явно, а не навешивается ambient middleware.
 */
export const basePipeline = compose(observability, validation);

/**
 * Слой аудита удалений: разбирает ответ-ошибку по **коду отказа**.
 *
 * `.is()` — единственный способ различения отказов: `instanceof` на
 * ответе не работает (в `.catch` приезжает контекст ответа, а не сам
 * `Fail`) и не пережил бы провод. Юнит ничего не заменяет — ничего не
 * возвращает, и ответ едет дальше как есть.
 */
export const auditDeletions = makePipeline<{ requestId: string }>().catch(
  (error) => {
    if (UserNotDeletable.is(error)) {
      // eslint-disable-next-line no-console
      console.log(
        `[audit] отказ в удалении ${error.value.details.id}: ` +
          `${error.value.details.reason}`,
      );
    }
  },
);

/**
 * Pipeline без валидации (для endpoint'ов без input или streaming) — тот же
 * слой наблюдаемости и ничего сверх него.
 *
 * ❌ НЕ содержит validate() - можно использовать только с endpoint'ами БЕЗ input схемы
 */
export { observability as noValidationPipeline } from '../modules/logger';
