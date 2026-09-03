/* eslint-disable no-console -- точка входа печатает адрес */
import { appSpec } from './app';

import { assemble } from '@nestling/app';

/**
 * Точка входа: `assemble` собирает приложение и проводит его по фазам.
 * Остановка по `SIGTERM` и `SIGINT` устанавливается автоматически.
 */
async function main(): Promise<void> {
  await assemble(appSpec).run();

  console.log('users-service: GET /health, GET /users, GET /openapi.json');
}

main().catch((error: unknown) => {
  console.error('failed to start:', error);
  // eslint-disable-next-line unicorn/no-process-exit
  process.exit(1);
});
