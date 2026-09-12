/**
 * Опции сервера в том виде, в каком их читает рантайм пакета.
 *
 * Плагин принимает словарь с необязательными полями, нормализует его один
 * раз при создании и кладёт результат в контейнер под {@link McpOptions$}.
 * Обработчик протокола и карта сессий читают уже нормализованное значение.
 */

import type { McpServerInfo } from './types.js';

import type { InjectionToken } from '@nestlingjs/container';
import { makeToken } from '@nestlingjs/container';

/** Путь endpoint'а по умолчанию */
export const DEFAULT_PATH = '/mcp';

/**
 * Предельное число открытых сессий по умолчанию.
 *
 * Сессия весит десятки байт, поэтому предел сторожит не память, а
 * бесконтрольный рост карты: без него каждый новый клиент добавлял бы
 * запись навсегда.
 */
export const DEFAULT_SESSION_LIMIT = 100;

/**
 * Срок бездействия сессии по умолчанию — пять минут.
 *
 * Столько же держат сессию большинство реализаций Streamable HTTP. Агент
 * между вызовами инструментов думает секунды, а не минуты, поэтому пять
 * минут переживают паузу в диалоге и не держат запись сутки.
 */
export const DEFAULT_SESSION_IDLE_MS = 5 * 60 * 1000;

/** Опции сервера после нормализации: значения по умолчанию уже подставлены */
export interface McpRuntimeOptions {
  /** Имя и версия сервера; уходят клиенту в ответе `initialize` */
  readonly server: McpServerInfo;

  /** Предельное число открытых сессий */
  readonly sessionLimit: number;

  /** Срок бездействия сессии в миллисекундах */
  readonly sessionIdleMs: number;
}

/**
 * DI-токен нормализованных опций.
 *
 * Публичен ради тестов и своих провайдеров: значение, которое читают
 * карта сессий и обработчик, должно быть доступно и снаружи.
 */
export const McpOptions$: InjectionToken<McpRuntimeOptions> =
  makeToken<McpRuntimeOptions>('nestling:mcp:options');
