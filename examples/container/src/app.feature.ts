import { ApiModule } from './api/index.js';
import { RuntimeModule } from './runtime/index.js';
import { UsersModule } from './users/index.js';
import { AppService } from './app.service.js';
import { Demo } from './demo.js';

import { makeFeature } from '@nestlingjs/app';
import { makeModule } from '@nestlingjs/container';

/** Корневой модуль: сервис приложения и модули, от которых он зависит */
export const AppModule = makeModule({
  name: 'module:app',
  providers: [AppService],
  dependsOn: [UsersModule, ApiModule, RuntimeModule],
});

/**
 * Демонстрация собранного графа: `@OnStart` живёт внутри фичи.
 *
 * Провайдеров у корня нет: они принимаются только рядом с `endpoints:`, а
 * `Demo` зависит от сервисов фичи — ребро «фича → провайдер корня» не
 * имело бы владельца.
 */
export const DemoModule = makeModule({
  name: 'module:demo',
  providers: [Demo],
});

/** Единственная фича примера; она содержит модули, а не наследует их */
export const AppFeature = makeFeature({
  name: 'app',
  modules: [AppModule, DemoModule],
});
