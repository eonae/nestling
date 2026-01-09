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

