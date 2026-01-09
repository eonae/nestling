import { AppService } from './app.service';
import { makeContainer } from './container';
import { IApiClient, IDatabase } from './interfaces';
import { ILogger } from './logging';
import { UserService } from './users';

// Пример использования
export async function main() {
  const container = await makeContainer();

  await container.init();

  // Получаем сервисы из контейнера
  const userService = container.getOrThrow(UserService);
  const database = container.getOrThrow(IDatabase);
  const apiClient = container.getOrThrow(IApiClient);
  const logger = container.getOrThrow(ILogger('app'));
  const appService = container.getOrThrow(AppService);

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

// eslint-disable-next-line no-console
main().catch(console.error);
