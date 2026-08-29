/**
 * Общие константы примера.
 */

/**
 * HTTP-статусы (для справки).
 */
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INTERNAL_ERROR: 500,
} as const;

/**
 * Максимальный размер файла аватара: 5 МБ.
 */
export const MAX_AVATAR_SIZE = 5_000_000;

/**
 * Идентификатор администратора: удалять его нельзя.
 */
export const ADMIN_USER_ID = '1';

/**
 * Бюджет вызова фичи квот из endpoint'а регистрации, в миллисекундах.
 *
 * У портов нет бюджета по умолчанию: неявный таймаут однажды оборвал бы
 * долгую, но корректную операцию, и владелец endpoint'а об этом не узнал
 * бы. Поэтому число задаёт тот, кто вызывает.
 */
export const QUOTA_CALL_BUDGET_MS = 500;

/**
 * Секрет для подписи входящих webhook'ов.
 *
 * В примере это литерал; в настоящем приложении секрет читают из
 * конфиг-секции (`docs/guides/config.md`).
 */
export const WEBHOOK_SECRET = 'example-webhook-secret';
