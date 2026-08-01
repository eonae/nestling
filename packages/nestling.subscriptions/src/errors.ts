/**
 * Причина административного аборта.
 *
 * Отдельный класс, потому что причину обязан различать хендлер: дисконнект
 * (`ClientDisconnectedError`) и остановку транспорта (`TransportClosingError`)
 * взводит ядро, а это — решение администратора, и обрабатываются они
 * по-разному.
 */
export class SubscriptionKilledError extends Error {
  constructor(
    /** Подписка, которую завершили */
    public readonly id: string,
    /** Текстовая причина — то, что администратор написал в `abort(id, …)` */
    public readonly reason = 'killed by subscription registry',
  ) {
    super(`Subscription ${id} killed: ${reason}`);
    this.name = 'SubscriptionKilledError';
  }
}
