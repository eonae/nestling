import { makeConfig } from '@nestling/config';
import { z } from 'zod';

/**
 * Секция плагина логирования: ключ `LOG_LEVEL`.
 *
 * Уровень живёт в секции, а не в параметре `logging({ … })`: параметр
 * плагина задаёт состав графа, секция задаёт то, что меняется без
 * пересборки.
 */
export const LoggerConfig = makeConfig('log', {
  level: z.enum(['debug', 'info', 'error']).default('info'),
});

/** Право привязать источник к ключам секции. Токен секции наружу не выходит */
export const loggerConfigKeys = LoggerConfig.keys;
