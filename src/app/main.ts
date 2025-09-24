import { ContainerBuilder, valueProvider } from '../framework';
import { AppModule } from './app.module';
import { AppService } from './app.service';
import { IApiClient, IDatabase, ILogger } from './di';
import { UserService } from './users';

// Пример использования
export async function main() {
  const builder = new ContainerBuilder();

  builder.register(AppModule);
  builder.register(
    valueProvider(ILogger, {
      log: (...args) => console.log('[LOG]', ...args)
    })
  );

  const container = await builder.build();

  await container.init();

  // Получаем сервисы из контейнера
  const userService = container.get(UserService);
  const database = container.get(IDatabase);
  const apiClient = container.get(IApiClient);
  const logger = container.get(ILogger);
  const appService = container.get(AppService);

  // Используем сервисы
  await database.connect();
  const users = await userService.getUsers();
  
  logger.log('Users:', users);
  
  // Тестируем API клиент
  const apiResponse = await apiClient.get('/api/users');
  logger.log('API Response:', apiResponse);

  // Тестируем AppService с инъекцией зависимостей
  const appInfo = await appService.getAppInfo();
  logger.log('App Info:', appInfo);

  await container.destroy();
}
