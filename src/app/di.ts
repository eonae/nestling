import { createInterfaceId } from '../framework';

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
export const ILogger = createInterfaceId<ILogger>('Logger');
export const IDatabase = createInterfaceId<IDatabase>('Database');
export const IConfig = createInterfaceId<IConfig>('Config');
export const IApiClient = createInterfaceId<IApiClient>('ApiClient');
