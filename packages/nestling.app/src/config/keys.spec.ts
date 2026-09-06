import {
  ConfigKeys,
  deriveKey,
  describeTarget,
  screamingSnake,
  targetCovers,
} from './keys.js';

describe('деривация имени ключа', () => {
  it.each([
    ['maxItems', 'MAX_ITEMS'],
    ['httpURL', 'HTTP_URL'],
    ['httpURLValue', 'HTTP_URL_VALUE'],
    ['s3Bucket', 'S3_BUCKET'],
    ['retries2', 'RETRIES2'],
    ['url', 'URL'],
    ['already_snake', 'ALREADY_SNAKE'],
  ])('%s → %s', (field, expected) => {
    expect(screamingSnake(field)).toBe(expected);
  });

  it('склеивает префикс с именем поля', () => {
    expect(deriveKey('orders', 'maxItems')).toBe('ORDERS_MAX_ITEMS');
  });

  it('приводит к SCREAMING_SNAKE и сам префикс', () => {
    expect(deriveKey('orderItems', 'maxItems')).toBe('ORDER_ITEMS_MAX_ITEMS');
  });
});

describe('таргеты привязки', () => {
  const keys = new ConfigKeys('orders', ['ORDERS_MAX_ITEMS', 'DATABASE_URL']);

  it('хэндл покрывает свои ключи и только их', () => {
    expect(targetCovers(keys, 'ORDERS_MAX_ITEMS')).toBe(true);
    expect(targetCovers(keys, 'DATABASE_URL')).toBe(true);
    expect(targetCovers(keys, 'USERS_MAX_ITEMS')).toBe(false);
  });

  it('глоб суффикса покрывает любой ключ с этим окончанием', () => {
    expect(targetCovers('*_GRPC_ADDRESS', 'USERS_GRPC_ADDRESS')).toBe(true);
    expect(targetCovers('*_GRPC_ADDRESS', 'ORDERS_GRPC_ADDRESS')).toBe(true);
    expect(targetCovers('*_GRPC_ADDRESS', 'GRPC_ADDRESS_X')).toBe(false);
  });

  it('глоб префикса и звёздочка целиком', () => {
    expect(targetCovers('ORDERS_*', 'ORDERS_MAX_ITEMS')).toBe(true);
    expect(targetCovers('ORDERS_*', 'USERS_MAX_ITEMS')).toBe(false);
    expect(targetCovers('*', 'ЧТО_УГОДНО')).toBe(true);
  });

  it('метасимволы регулярок в глобе экранируются', () => {
    expect(targetCovers('A.B', 'AxB')).toBe(false);
    expect(targetCovers('A.B', 'A.B')).toBe(true);
  });

  it('называет таргет в человекочитаемом виде', () => {
    expect(describeTarget(keys)).toBe('ConfigKeys(orders)');
    expect(describeTarget('*_URL')).toBe("'*_URL'");
  });

  it('хэндл заморожен вместе со списком имён', () => {
    expect(Object.isFrozen(keys)).toBe(true);
    expect(Object.isFrozen(keys.names)).toBe(true);
  });
});
