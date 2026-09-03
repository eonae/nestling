import { ApiModule } from './api';
import { AppService } from './app.service';
import { HealthModule } from './health';
import { RuntimeModule } from './runtime';
import { UsersModule } from './users';

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
