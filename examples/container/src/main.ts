import { appConfigKeys } from './config/index.js';
import { appCounters } from './counters/index.js';
import { runtimeConfigKeys } from './runtime/index.js';
import { AppFeature } from './app.feature.js';

import { makeApp, objectSource } from '@nestling/app';

/**
 * Composition root без транспорта: приложение проходит фазы и остаётся в
 * RUN. Демонстрация живёт в `@OnStart` провайдера `Demo`.
 *
 * Источники конфига привязываются к ключам секций. `process.env`
 * подключён всегда с низшим приоритетом: `DATABASE_URL` приходит из него
 * без объявления. Порядок списка задаёт приоритет источников. Уровень и
 * формат логгера ядра задают `NESTLING_LOG_LEVEL` и `NESTLING_LOG_FORMAT`
 * из `process.env`.
 */
const app = makeApp({
  features: [AppFeature],
  plugins: [appCounters],
  config: [
    [objectSource({ APP_METRICS_PREFIX: 'demo' }, 'defaults'), appConfigKeys],
    [objectSource({ RUNTIME_RPS: '50' }, 'runtime'), runtimeConfigKeys],
  ],
}).assemble();

await app.run();
await app.close();
