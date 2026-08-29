/* eslint-disable no-console */

import { observability } from './modules/logger';
import { OpsFeature, QuotasFeature, UsersFeature } from './features';
import { appLogging, appSubscriptions } from './infrastructure';

import { assemble } from '@nestling/app';
import { load, makeConfig } from '@nestling/config';
import { openapi } from '@nestling/openapi';
import { zodConverter } from '@nestling/openapi.zod';
import { everyEndpoint, RequestId } from '@nestling/pipeline';
import { http, HttpTransport$ } from '@nestling/transport.http';
import { z } from 'zod';

/**
 * Секция конфига, которую корень читает до сборки контейнера.
 *
 * `load(section)` — единственный способ прочитать конфиг до `assemble`.
 * Выбор фич нужен раньше контейнера, поэтому его читают на фазе 0.
 */
const RootConfig = makeConfig('app', {
  features: z.string().default('all'),
});

/**
 * Собирает и запускает приложение: `assemble` — единственный composition
 * root.
 *
 * `APP_FEATURES=users` поднимает только фичу пользователей (вместе с `ops`
 * и `quotas`, от которых она зависит), `APP_FEATURES=all` — все фичи.
 * Сквозная инфраструктура (логирование, реестр подписок, документация)
 * подключается через `modules:`, как любой другой модуль.
 */
async function main() {
  // Фаза 0: выбор фич читается до построения контейнера
  const cfg = load(RootConfig);

  const app = assemble({
    features: [UsersFeature, OpsFeature, QuotasFeature],
    select: cfg.features,
    // Документация OpenAPI — обычный параметризованный модуль. Документ
    // строится на фазе ASSEMBLE, поэтому схема без конвертера роняет старт
    // до открытия сокета.
    //
    // `pipeline: observability`: политика корня ниже требует этот слой от
    // каждого HTTP-endpoint'а, а модуль документации о нём не знает.
    // Юниты слоя поставляет `appLogging`, поэтому он тоже стоит в
    // `modules:`.
    modules: [
      appLogging,
      // Реестр подписок — тоже параметризованный модуль. Значение создано
      // один раз в `infrastructure.ts` и импортируется отсюда и из фич
      appSubscriptions,
      openapi({
        info: {
          title: 'Users API',
          version: '1.0.0',
          description:
            'Пример HTTP-приложения Nestling: документ выведен из тех же ' +
            'деклараций, которые обслуживают запросы.',
        },
        converters: [zodConverter()],
        pipeline: observability,
      }),
    ],
    // Транспорт — провайдер. Порт берётся из его конфиг-секции
    // (`HTTP_PORT`); явная опция имеет приоритет
    transports: [http({ port: 3000 })],
    // Два инварианта приложения; оба проверяются на собранном графе до
    // `@OnInit` и до открытия сокета.
    //
    // Первый: каждый HTTP-endpoint композирован от слоя `observability`.
    // Слой сравнивается по ссылке, поэтому одноимённая копия из другого
    // файла политику не удовлетворит. Единственное исключение — `Health`,
    // и оно помечено `detached` с причиной.
    //
    // Второй: пайплайн каждого HTTP-endpoint'а кладёт в контекст
    // `RequestId`. Репозиторий читает его через `Ctx(RequestId)` из
    // глубины графа, где типы входа недоступны; без политики endpoint без
    // этой переменной падал бы на запросе, а не на сборке.
    policies: [
      everyEndpoint({ transport: HttpTransport$ }).hasLayer(
        observability,
        'observability',
      ),
      everyEndpoint({ transport: HttpTransport$ }).hasVar(
        RequestId,
        'requestId',
      ),
    ],
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
  console.log(
    '  - GET    /api/users/activity     - Activity feed (SSE, трекается реестром)',
  );
  console.log(
    '  - POST   /api/users/:id/avatar   - Upload avatar (multipart + upload)',
  );
  console.log('  - POST   /api/hooks/users        - Webhook (rawBody + HMAC)');
  console.log('  - GET    /api/ops/subscriptions  - Активные подписки узла');
  console.log(
    '  - DELETE /api/ops/subscriptions/:id - Завершить подписку (админский kill)',
  );
  console.log(
    '  - GET    /api/ops/subscriptions/live - Лента изменений реестра (SSE)',
  );
  console.log(
    '  - GET    /health                 - Liveness (detached: вне политик)',
  );
  console.log(
    '  - GET    /openapi.json           - OpenAPI 3.1 (выведен из деклараций)',
  );
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
  console.log('Реестр подписок (satellite поверх публичных примитивов):');
  console.log(
    '  curl -N  http://localhost:3000/api/users/activity   — открыть подписку',
  );
  console.log(
    '  curl     http://localhost:3000/api/ops/subscriptions — увидеть её',
  );
  console.log(
    '  curl -X DELETE http://localhost:3000/api/ops/subscriptions/<id>',
  );
  console.log('  curl -N  http://localhost:3000/api/ops/subscriptions/live');
  console.log('');
  console.log('Выбор подмножества фич:');
  console.log('  APP_FEATURES=users yarn start   — только пользователи');
  console.log('  APP_FEATURES=all   yarn start   — всё дерево (по умолчанию)');
  console.log('');
  console.log('Порты между фичами (users ↔ quotas):');
  console.log(
    '  POST /api/users зовёт контракт quotas.claim и публикует users.registered',
  );
  console.log(
    '  NESTLING_PORTS_DISPATCH=always-remote yarn start — те же вызовы через шину',
  );
  console.log(
    '  (репетиция split: async-барьер, структурная копия, валидация ответа;',
  );
  console.log('   call-site при этом не меняется ни на строчку)');
  console.log('');
}

main().catch((error) => {
  console.error('Failed to start app:', error);
  // eslint-disable-next-line unicorn/no-process-exit
  process.exit(1);
});
