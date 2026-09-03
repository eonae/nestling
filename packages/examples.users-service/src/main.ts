/* eslint-disable no-console -- точка входа печатает адрес */
import { app } from './app';

/**
 * Точка входа: `assemble()` собирает приложение для этого процесса,
 * `run()` проводит его по фазам. Остановка по `SIGTERM` и `SIGINT`
 * устанавливается автоматически.
 */
async function main(): Promise<void> {
  await app.assemble().run();

  console.log('users-service: GET /health, GET /users, GET /openapi.json');
}

main().catch((error: unknown) => {
  console.error('failed to start:', error);
  // eslint-disable-next-line unicorn/no-process-exit
  process.exit(1);
});
