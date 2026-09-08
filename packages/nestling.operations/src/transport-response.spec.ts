import { Ok } from './result.js';
import type { TransportResponse } from './transport-response.js';
import { isTransportResponse, TRANSPORT_RESPONSE } from './transport-response.js';

/** Конверт транспорта: так его собирает пакет транспорта */
const envelope: TransportResponse<{ id: number }> = {
  [TRANSPORT_RESPONSE]: true,
  transport: 'http',
  meta: { headers: { location: '/users/1' } },
  result: Ok.created({ id: 1 }),
};

describe('TransportResponse — конверт транспортного ответа', () => {
  it('распознаётся по метке, а не по прототипу', () => {
    expect(isTransportResponse(envelope)).toBe(true);
    expect(isTransportResponse({ ...envelope })).toBe(true);
  });

  it('несёт имя транспорта, метаданные и результат', () => {
    expect(envelope.transport).toBe('http');
    expect(envelope.meta).toEqual({ headers: { location: '/users/1' } });
    expect(envelope.result).toBeInstanceOf(Ok);
  });

  it('обычный ответ конвертом не считается', () => {
    expect(isTransportResponse(Ok.created({ id: 1 }))).toBe(false);
    expect(isTransportResponse({ id: 1 })).toBe(false);
    expect(isTransportResponse(null)).toBe(false);
    expect(isTransportResponse(undefined)).toBe(false);
  });
});
