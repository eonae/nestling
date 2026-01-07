export const statuses = [
  'OK',
  'CREATED',
  'ACCEPTED',
  'NO_CONTENT',
  'PAYMENT_REQUIRED',
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'INTERNAL_ERROR',
  'NOT_IMPLEMENTED',
  'SERVICE_UNAVAILABLE',
] as const;

export type ProcessingStatus = (typeof statuses)[number];
