import { app } from './app.js';

/**
 * Точка входа: `assemble()` собирает приложение для этого процесса,
 * `run()` проводит его по фазам. Остановка по `SIGTERM` и `SIGINT`
 * устанавливается автоматически.
 */
await app.assemble().run();
