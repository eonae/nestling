import { makeToken } from '@nestling/container';

export const IDatabase = makeToken<IDatabase>('Database');
export interface IDatabase {
  connect(): Promise<void>;
  query(sql: string): Promise<any[]>;
}

export const IConfig = makeToken<IConfig>('Config');
export interface IConfig {
  databaseUrl: string;
  logLevel: string;
}

export const IApiClient = makeToken<IApiClient>('ApiClient');
export interface IApiClient {
  get(url: string): Promise<any>;
}
