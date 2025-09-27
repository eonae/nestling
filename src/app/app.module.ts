import { makeModule } from '../framework';
import { ApiModule } from './api';
import { AppService } from './app.service';
import { UsersModule } from './users';

export const AppModule = makeModule({
  name: 'module:app',
  providers: [AppService],
  imports: [UsersModule, ApiModule],
});
