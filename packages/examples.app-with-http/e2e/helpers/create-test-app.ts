import { App } from '@nestling/app';
import { HttpTransport } from '@nestling/transport.http';
import { LoggerModule } from '../../src/modules/logger/logger.module';
import { UsersModule } from '../../src/users.module';

export interface TestAppContext {
  app: App;
  baseUrl: string;
}

/**
 * Создает тестовое приложение на случайном порту
 */
export async function createTestApp(): Promise<TestAppContext> {
  const port = 3000 + Math.floor(Math.random() * 1000); // Случайный порт 3000-4000

  const app = new App({
    modules: [LoggerModule, UsersModule],
    transports: {
      http: new HttpTransport({ port }),
    },
  });

  await app.run();

  const baseUrl = `http://localhost:${port}`;

  return { app, baseUrl };
}

/**
 * Закрывает тестовое приложение
 */
export async function closeTestApp(context: TestAppContext): Promise<void> {
  if (context.app) {
    await context.app.close();
  }
}

