import { ApiModule } from './api';
import { AppService } from './app.service';
import { UsersModule } from './users';

import { makeModule } from '@nestling/container';

export const AppModule = makeModule({
  name: 'module:app',
  providers: [AppService],
  imports: [UsersModule, ApiModule],
});
