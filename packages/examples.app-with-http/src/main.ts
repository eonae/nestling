/* eslint-disable no-console */

import { LoggingFeature, UsersFeature } from './features';

import { assemble } from '@nestling/app';
import { load, makeConfig } from '@nestling/config';
import { http } from '@nestling/transport.http';
import { z } from 'zod';

/**
 * Секция корня: что читается **до** сборки.
 *
 * Единственное пред-сборочное чтение конфига — `load(section)`: выбор фич
 * нужен раньше контейнера, поэтому он и живёт в фазе 0 (BOOTSTRAP).
 */
const RootConfig = makeConfig('app', {
  features: z.string().default('all'),
});

/**
 * Пример: `assemble` как единственный composition root.
 *
 * Уровень L2 — фичи и выбор подмножества: `APP_FEATURES=users` поднимает
 * только пользователей (с транзитивно приезжающим `logging`),
 * `APP_FEATURES=all` — всё дерево.
 */
async function main() {
  // Фаза 0: выбор фич считается до построения контейнера
  const cfg = load(RootConfig);

  const app = assemble({
    features: [UsersFeature, LoggingFeature],
    select: cfg.features,
    // Транспорт — провайдер: порт приезжает из его конфиг-секции
    // (`HTTP_PORT`), явная опция её перекрывает
    transports: [http({ port: 3000 })],
  });

  await app.run();

  console.log('🚀 App is running');
  console.log(`📦 Features: ${cfg.features}`);
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
  console.log('Выбор подмножества фич:');
  console.log('  APP_FEATURES=users yarn start   — только пользователи');
  console.log('  APP_FEATURES=all   yarn start   — всё дерево (по умолчанию)');
  console.log('');
}

main().catch((error) => {
  console.error('Failed to start app:', error);
  // eslint-disable-next-line unicorn/no-process-exit
  process.exit(1);
});
