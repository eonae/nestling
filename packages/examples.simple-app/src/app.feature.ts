import { ApiModule } from './api';
import { AppService } from './app.service';
import { HealthModule } from './health';
import { UsersModule } from './users';

import { makeFeature } from '@nestling/app';
import { makeModule } from '@nestling/container';

/** Модуль корня фичи: сервис приложения плюс модули, без которых он не работает */
export const AppModule = makeModule({
  name: 'module:app',
  providers: [AppService],
  dependsOn: [UsersModule, ApiModule, HealthModule],
});

/**
 * Единственная фича примера: она содержит модули, а не наследует модуль.
 */
export const AppFeature = makeFeature({
  name: 'app',
  modules: [AppModule],
});
