/**
 * `@nestling/openapi` — документ OpenAPI 3.1 из деклараций.
 *
 * Три поверхности и ни одной больше:
 *
 * - `buildOpenApiDocument(endpoints, options)` — чистая функция; её зовёт
 *   CI, чтобы положить `openapi.json` в артефакты, не поднимая приложение;
 * - `openapi(options)` — модуль-издатель: строит документ на фазе ASSEMBLE
 *   и отдаёт его endpoint'ом `GET /openapi.json`;
 * - `OpenApiDocument$` — токен готового документа для тех, кому он нужен
 *   значением.
 *
 * Зависимости от валидатора у пакета нет: перевод схемы в JSON Schema
 * приходит **данными** — списком `SchemaDocConverter`, который поставляют
 * отдельные пакеты (`@nestling/openapi.zod` и подобные).
 */

export { buildOpenApiDocument, hiddenEndpoints } from './document.js';
export { openapi, OpenApiDocument$ } from './module.js';
export type { OpenApiServeOptions } from './module.js';
export type {
  DocumentedEndpoint,
  JsonValue,
  OpenApiContent,
  OpenApiDocument,
  OpenApiInfo,
  OpenApiOperation,
  OpenApiOptions,
  OpenApiParameter,
  OpenApiPathItem,
  OpenApiRequestBody,
  OpenApiResponse,
} from './types.js';

/**
 * Интерфейс вендор-конвертера — реэкспорт схемного слоя.
 *
 * Автор своего конвертера пишет его против того же типа, который принимает
 * снапшот операций: тип один на обоих потребителей, и заводить второй
 * ради удобства импорта было бы ровно тем расщеплением, от которого этот
 * операция и защищает.
 */
export type { SchemaDocConverter } from '@nestling/pipeline';
