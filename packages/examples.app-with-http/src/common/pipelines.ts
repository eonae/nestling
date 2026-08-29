import { observability } from '../modules/logger';
import { UserNotDeletable } from '../modules/users/user.errors';

import { compose, makePipeline, validate } from '@nestling/pipeline';

/**
 * Внутренний слой: валидация payload.
 *
 * `makePipeline<{ requestId: string }>()` объявляет, что слой ожидает
 * `requestId` от внешнего слоя; компилятор проверяет это в `compose`.
 */
const validation = makePipeline<{ requestId: string }>().pre(validate());

/**
 * Базовый пайплайн: наблюдаемость плюс валидация.
 *
 * Подходит endpoint'ам со схемой `input`. Внешний слой поставляет
 * инфраструктурный модуль логирования: сквозное поведение подключается
 * явной композицией, а не невидимым middleware.
 */
export const basePipeline = compose(observability, validation);

/**
 * Слой аудита удалений: в `.catch` распознаёт отказ по коду.
 *
 * `.is()` — единственный способ отличить отказ: в `.catch` приходит
 * контекст ответа, а не сам `Fail`, поэтому `instanceof` не подходит.
 * Юнит ничего не возвращает, и ответ идёт дальше без изменений.
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
 * Пайплайн без валидации: тот же слой наблюдаемости и ничего сверх него.
 *
 * Для endpoint'ов без `input` и для потокового входа, который валидирует
 * item-цепочка.
 */
export { observability as noValidationPipeline } from '../modules/logger';
