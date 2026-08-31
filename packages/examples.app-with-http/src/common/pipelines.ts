import { UserNotDeletable } from '../modules/users/user.errors';

import { makePipeline } from '@nestling/pipeline';

/**
 * Базовый пайплайн: наблюдаемость.
 *
 * Подходит любому endpoint'у. Вход по схеме `input` проверяет рантайм
 * перед хендлером, поэтому юнита проверки в пайплайне нет и отдельного
 * пайплайна «без проверки» не требуется.
 */
export { observability as basePipeline } from '../modules/logger';

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
