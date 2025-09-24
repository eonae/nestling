import { makeToken } from '../framework';

// Интерфейсы
export interface ILogger {
  log(...args: unknown[]): void;
}

export interface IDatabase {
  connect(): Promise<void>;
  query(sql: string): Promise<any[]>;
}

export interface IConfig {
  databaseUrl: string;
  logLevel: string;
}

export interface IApiClient {
  get(url: string): Promise<any>;
}

// Создаем InterfaceId
export const ILogger = makeToken<ILogger>('Logger');
export const IDatabase = makeToken<IDatabase>('Database');
export const IConfig = makeToken<IConfig>('Config');
export const IApiClient = makeToken<IApiClient>('ApiClient');
