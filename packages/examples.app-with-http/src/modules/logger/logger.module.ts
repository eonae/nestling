import { ConsoleLogger, ILogger } from './logger.service';

import { makeModule } from '@nestling/container';

/**
 * Модуль логгера
 */
export const LoggerModule = makeModule({
  name: 'module:logger',
  providers: [ConsoleLogger],
  exports: [ILogger],
});
