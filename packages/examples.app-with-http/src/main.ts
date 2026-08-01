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
 * только пользователей (с транзитивно приезжающим `ops`),
 * `APP_FEATURES=all` — всё дерево. Поля корня перечислены здесь целиком:
 * никакого `plugins:` в словаре нет — сквозная инфраструктура приезжает
 * теми же `modules:`/`providers:`, что и всё остальное, или модулем фичи.
 */
async function main() {
  // Фаза 0: выбор фич считается до построения контейнера
  const cfg = load(RootConfig);

  const app = assemble({
    features: [UsersFeature, OpsFeature, QuotasFeature],
    select: cfg.features,
    // Документация — обычный параметризованный модуль, а не поле корня и не
    // «плагин»: примитива под неё в ядре нет. Документ строится на фазе
    // ASSEMBLE провайдером жадного контейнера, поэтому схема без конвертера
    // роняет старт до открытия сокета — недокументируемых ручек в
    // приложении не бывает, пока документация включена.
    //
    // `pipeline: observability` — потому что корень требует этот слой от
    // каждой HTTP-ручки, а satellite-модуль про него ничего не знает.
    // Вместе со слоем корень берёт на себя и его юнит: `appLogging` едет
    // сюда именно поэтому, а не «на всякий случай».
    modules: [
      appLogging,
      // Реестр подписок — satellite-пакет, подключённый той же конвенцией
      // параметризованного модуля: ни поля корня, ни «плагина» под него не
      // появилось. Значение создаётся один раз в `infrastructure.ts`
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
    // Транспорт — провайдер: порт приезжает из его конфиг-секции
    // (`HTTP_PORT`), явная опция её перекрывает
    transports: [http({ port: 3000 })],
    // Инвариант приложения: каждая HTTP-ручка обязана быть композирована
    // от слоя наблюдаемости, который поставляет инфра-модуль логирования.
    // Так выражается «ambient middleware»: слой композируют явно, а
    // вездесущность гарантирует проверка на собранном графе — до `@OnInit`
    // и до открытия сокета. Идентичность слоя ссылочная, поэтому
    // одноимённая копия из соседнего файла политику не удовлетворит.
    // Исключение ровно одно и с причиной: `Health` помечена `detached`.
    //
    // Второй инвариант — про ambient-контекст: репозиторий читает
    // `Ctx(RequestId)` из глубины графа, где типов входа уже нет, и типами
    // такое чтение не подстрахуешь. Политика закрывает ровно эту дыру:
    // ручка, чей пайплайн переменную не кладёт, роняет сборку, а не запрос.
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
