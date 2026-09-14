/**
 * Атрибуты ресурса: чьи это трассы и метрики.
 *
 * Ресурс один на обе части сателлита, поэтому участок и точка метрики
 * приходят в коллектор от одного и того же сервиса.
 */

import type { OtelOptions } from './options.js';

import type { Resource } from '@opentelemetry/resources';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';

/**
 * Собирает ресурс по опциям сателлита.
 *
 * Версия попадает в атрибуты, только если она задана: пустая строка в
 * `service.version` означала бы версию с таким именем.
 *
 * @param options - Опции сателлита
 * @returns Ресурс с атрибутами `service.name` и `service.version`
 */
export function serviceResource(options: OtelOptions): Resource {
  return resourceFromAttributes({
    [ATTR_SERVICE_NAME]: options.service,
    ...(options.version === undefined
      ? {}
      : { [ATTR_SERVICE_VERSION]: options.version }),
  });
}
