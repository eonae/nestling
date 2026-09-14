/**
 * `@nestlingjs/openapi` — документ OpenAPI 3.1 из деклараций.
 *
 * Две поверхности и ни одной больше:
 *
 * - `makeOpenapi(options)` — плагин-издатель: строит документ на фазе BUILD
 *   и отдаёт его endpoint'ом `GET /openapi.json`. Его же метод
 *   `document(app.discover(args))` кладёт документ в артефакты сборки, не
 *   поднимая приложение: опции у плагина уже есть, поэтому `info` записан
 *   ровно в одном месте;
 * - `OpenApiDocument$` — DI-токен готового документа для тех, кому он нужен
 *   значением.
 *
 * Валидатора публичные типы пакета не называют: схема приходит от
 * приложения, а перевод в JSON Schema — списком `SchemaDocConverter`.
 * Конвертер вендора, на котором написаны схемы фреймворка, подставляется
 * умолчанием, поэтому строки в опциях он не требует.
 */

export { makeOpenapi, OpenApiDocument$ } from './module.js';
export type { OpenApiPlugin, OpenApiServeOptions } from './module.js';
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
export type { SchemaDocConverter } from '@nestlingjs/app';
