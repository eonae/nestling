import { makeModule } from '@nestling/container';
import { ConsoleLogger, ILogger } from './logger.service';

/**
 * Модуль логгера
 */
export const LoggerModule = makeModule({
  name: 'module:logger',
  providers: [ConsoleLogger],
  exports: [ILogger],
});

