// Успешные статусы (2xx)
export const successStatuses = [
  'OK', // 200
  'CREATED', // 201
  'ACCEPTED', // 202
  'NO_CONTENT', // 204
] as const;

// Статусы ошибок (4xx, 5xx)
//
// Статус — транспортно-нейтральная семантика «как отвечать»; перевод в код
// провода делает транспорт (для HTTP — STATUS_MAP в @nestling/transport.http).
export const errorStatuses = [
  'PAYMENT_REQUIRED', // 402
  'BAD_REQUEST', // 400
  'UNAUTHORIZED', // 401
  'FORBIDDEN', // 403
  'NOT_FOUND', // 404
  'CONFLICT', // 409
  'TOO_MANY_REQUESTS', // 429
  'INTERNAL_ERROR', // 500
  'NOT_IMPLEMENTED', // 501
  'SERVICE_UNAVAILABLE', // 503
  // «операция не уложилась в бюджет» (в т.ч. будущий DeadlineExceeded
  // портов) — это 504, а не 408: 408 про то, что клиент не дослал запрос.
  'TIMEOUT', // 504
] as const;

// Все статусы (для внутреннего использования в транспортах)
export const statuses = [...successStatuses, ...errorStatuses] as const;

export type SuccessStatus = (typeof successStatuses)[number];
export type ErrorStatus = (typeof errorStatuses)[number];
export type ProcessingStatus = (typeof statuses)[number];
