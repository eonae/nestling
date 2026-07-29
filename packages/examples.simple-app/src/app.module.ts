import { ApiModule } from './api';
import { AppService } from './app.service';
import { HealthModule } from './health';
import { UsersModule } from './users';

import { makeModule } from '@nestling/container';

export const AppModule = makeModule({
  name: 'module:app',
  providers: [AppService],
  imports: [UsersModule, ApiModule, HealthModule],
});
