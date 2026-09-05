/**
 * Связь контроллера с чужим сигналом отмены.
 *
 * Внутренний модуль пакета: помощник нужен бюджету вызова (`profile.ts`)
 * и in-process шине (`bus.ts`) и из `index.ts` не экспортируется.
 */

/**
 * Взводит `target`, когда взведён `source`.
 *
 * Если `source` уже взведён, `target` взводится сразу с той же причиной.
 * Иначе на `source` ставится слушатель `abort` с `once`.
 *
 * @param source - Сигнал, за которым следует контроллер
 * @param target - Контроллер, который взводится причиной `source`
 * @returns Функция снятия слушателя; вызывающий обязан вызвать её по
 * завершении вызова, иначе слушатель переживёт вызов
 */
export function followSignal(
  source: AbortSignal,
  target: AbortController,
): () => void {
  if (source.aborted) {
    target.abort(source.reason);

    return () => {
      /* слушатель не ставился */
    };
  }

  const onAbort = (): void => target.abort(source.reason);
  source.addEventListener('abort', onAbort, { once: true });

  return () => source.removeEventListener('abort', onAbort);
}
