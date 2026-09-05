import { ApiModule } from './api/index.js';
import { HealthModule } from './health/index.js';
import { RuntimeModule } from './runtime/index.js';
import { UsersModule } from './users/index.js';
import { AppService } from './app.service.js';

import { makeFeature } from '@nestling/app';
import { makeModule } from '@nestling/container';

/** Корневой модуль: сервис приложения и модули, от которых он зависит */
export const AppModule = makeModule({
  name: 'module:app',
  providers: [AppService],
  dependsOn: [UsersModule, ApiModule, HealthModule, RuntimeModule],
});

/** Единственная фича примера; она содержит модули, а не наследует их */
export const AppFeature = makeFeature({
  name: 'app',
  modules: [AppModule],
});
