import { makeToken } from '@nestling/container';

/**
 * Интерфейсы и их токены.
 *
 * Интерфейс и токен носят одно имя; токен отличает суффикс `$`. Токен
 * нужен, потому что интерфейс во время выполнения не существует.
 */

export interface Database {
  connect(): Promise<void>;
  query(sql: string): Promise<any[]>;
}
export const Database$ = makeToken<Database>('Database');

export interface ApiClient {
  get(url: string): Promise<any>;
}
export const ApiClient$ = makeToken<ApiClient>('ApiClient');
