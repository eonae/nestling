// Успешные статусы (2xx)
export const successStatuses = [
  'OK', // 200
  'CREATED', // 201
  'ACCEPTED', // 202
  'NO_CONTENT', // 204
] as const;

// Статусы ошибок (4xx, 5xx)
export const errorStatuses = [
  'PAYMENT_REQUIRED', // 402
  'BAD_REQUEST', // 400
  'UNAUTHORIZED', // 401
  'FORBIDDEN', // 403
  'NOT_FOUND', // 404
  'INTERNAL_ERROR', // 500
  'NOT_IMPLEMENTED', // 501
  'SERVICE_UNAVAILABLE', // 503
] as const;

// Все статусы (для внутреннего использования в транспортах)
export const statuses = [...successStatuses, ...errorStatuses] as const;

export type SuccessStatus = (typeof successStatuses)[number];
export type ErrorStatus = (typeof errorStatuses)[number];
export type ProcessingStatus = (typeof statuses)[number];
