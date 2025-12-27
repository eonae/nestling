import type { InjectionToken } from '@nestling/container';
import { makeToken } from '@nestling/container';

export interface ILogger {
  log(...args: unknown[]): void;
}

export const loggersRegistry = new Set<InjectionToken<ILogger>>();

export const ILogger = (scope: string) => {
  const token = makeToken<ILogger>(`Logger:${scope}`);
  loggersRegistry.add(token);
  return token;
};
