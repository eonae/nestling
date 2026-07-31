/**
 * Общие константы
 */

/**
 * HTTP статус коды (для справки)
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
 * Максимальный размер файла аватара (5MB)
 */
export const MAX_AVATAR_SIZE = 5_000_000;

/**
 * ID защищенного admin пользователя
 */
export const ADMIN_USER_ID = '1';

/**
 * Бюджет вызова соседней фичи из ручки регистрации.
 *
 * Дефолтного бюджета у портов нет: framework default — это неявный таймаут,
 * который однажды обрежет легальную длинную операцию, и владелец ручки о нём
 * не узнает. Поэтому число живёт здесь, у владельца вызова.
 */
export const QUOTA_CALL_BUDGET_MS = 500;

/**
 * Секрет для подписи входящих webhook'ов.
 *
 * В примере — литерал; в приложении это конфиг-секция
 * (`docs/design/config.md`), а не константа в коде.
 */
export const WEBHOOK_SECRET = 'example-webhook-secret';
