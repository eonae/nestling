/**
 * Логгер путей без `App`: `makeDispatch`, `new InProcessBus()` и рантайм
 * пайплайна, вызванный без опции `logger`.
 *
 * Порог `info`, формат `text`, секции нет: конфиг поднимает корень, а на
 * этих путях корня не бывает. Правило «незадекларированный отказ не
 * проглатывается молча» держится на нём, поэтому значение одно на процесс
 * и создаётся при загрузке модуля: `execute` зовётся на каждый запрос, и
 * платить там за создание логгера незачем.
 *
 * Из пакета не экспортируется: наружу идёт `makeConsoleLogger`.
 */

import type { Logger } from '@nestlingjs/logging';
import { makeConsoleLogger } from '@nestlingjs/logging';

/** Умолчание standalone-путей */
export const defaultLogger: Logger = makeConsoleLogger();
