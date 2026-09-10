import { makeToken } from '@nestlingjs/container';

/**
 * Интерфейсы и их DI-токены.
 *
 * Интерфейс и DI-токен носят одно имя; DI-токен отличает суффикс `$`.
 * DI-токен нужен, потому что интерфейс во время выполнения не существует.
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
