import { appConfigKeys } from './config/index.js';
import { appLogging } from './logging/index.js';
import { runtimeConfigKeys } from './runtime/index.js';
import { AppFeature } from './app.feature.js';
import { Demo } from './demo.js';

import { makeApp } from '@nestling/app';
import { objectSource } from '@nestling/config';

/**
 * Composition root без транспорта: приложение проходит фазы и остаётся в
 * RUN. Демонстрация живёт в `@OnStart` провайдера `Demo`.
 *
 * Источники конфига привязываются к ключам секций. `process.env`
 * подключён всегда с низшим приоритетом: `DATABASE_URL` приходит из него
 * без объявления. Порядок списка задаёт приоритет источников.
 */
const app = makeApp({
  features: [AppFeature],
  plugins: [appLogging],
  providers: [Demo],
  config: [
    [objectSource({ APP_LOG_LEVEL: 'debug' }, 'defaults'), appConfigKeys],
    [objectSource({ RUNTIME_RPS: '50' }, 'runtime'), runtimeConfigKeys],
  ],
}).assemble();

await app.run();
await app.close();
