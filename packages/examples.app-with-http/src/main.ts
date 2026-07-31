/* eslint-disable no-console */

import { LoggerModule } from './modules/logger/logger.module';
import { UsersModule } from './users.module';

import { App } from '@nestling/app';
import { HttpTransport } from '@nestling/transport.http';

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
  console.log('🔌 Endpoints:');
  console.log('  - GET    /api/users              - List users');
  console.log('  - GET    /api/users/:id          - Get user by ID');
  console.log(
    '  - POST   /api/users              - Create user (?dryRun=true — только проверка)',
  );
  console.log('  - PATCH  /api/users/:id          - Update user');
  console.log('  - DELETE /api/users/:id          - Delete user');
  console.log('  - GET    /api/users/search       - Search users');
  console.log('  - GET    /api/users/export       - Export users (NDJSON)');
  console.log('  - POST   /api/users/import       - Import users (NDJSON)');
  console.log('  - GET    /api/users/activity     - Activity feed (SSE)');
  console.log(
    '  - POST   /api/users/:id/avatar   - Upload avatar (multipart + upload)',
  );
  console.log('  - POST   /api/hooks/users        - Webhook (rawBody + HMAC)');
  console.log('⚙️  Middleware: TimingMiddleware');
  console.log('');
  console.log('✅ Server listening on http://localhost:3000');
  console.log('');
  console.log('Try these endpoints:');
  console.log('  GET  http://localhost:3000/api/users');
  console.log('  GET  http://localhost:3000/api/users/1');
  console.log('  POST http://localhost:3000/api/users');
  console.log(
    '       Body: {"name": "Charlie", "email": "charlie@example.com"}',
  );
  console.log('');
  console.log('Потоковые формы:');
  console.log('  curl -N     http://localhost:3000/api/users/export');
  console.log('  curl -N     http://localhost:3000/api/users/activity');
  console.log(
    '  curl -H "content-type: application/x-ndjson" --data-binary @rows.ndjson \\',
  );
  console.log('       http://localhost:3000/api/users/import');
  console.log(
    '  curl -F avatar=@photo.png http://localhost:3000/api/users/1/avatar',
  );
  console.log('');
}

main().catch((error) => {
  console.error('Failed to start app:', error);
  // eslint-disable-next-line unicorn/no-process-exit
  process.exit(1);
});
