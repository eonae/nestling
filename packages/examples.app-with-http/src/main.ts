import { App } from '@nestling/app';
import { HttpTransport } from '@nestling/transport.http';
import { LoggerModule } from './logger.module';
import { UsersModule } from './users.module';

/**
 * Пример использования App с HTTP транспортом, endpoints и middleware
 */
async function main() {
  // Создаём приложение
  const app = new App({
    modules: [LoggerModule, UsersModule],
    transports: {
      http: new HttpTransport({ port: 3000 }),
    },
  });

  // Запускаем приложение (init + listen + graceful shutdown)
  await app.run();

  console.log('🚀 App is running');
  console.log('📦 Modules: LoggerModule, UsersModule');
  console.log('🔌 Endpoints: GetUser, ListUsers, CreateUser');
  console.log('⚙️  Middleware: TimingMiddleware');
  console.log('');
  console.log('✅ Server listening on http://localhost:3000');
  console.log('');
  console.log('Try these endpoints:');
  console.log('  GET  http://localhost:3000/api/users');
  console.log('  GET  http://localhost:3000/api/users/1');
  console.log('  POST http://localhost:3000/api/users');
  console.log('       Body: {"name": "Charlie", "email": "charlie@example.com"}');
  console.log('');
}

main().catch((error) => {
  console.error('Failed to start app:', error);
  process.exit(1);
});

