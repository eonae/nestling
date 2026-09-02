/**
 * Типы документа и опций генератора.
 *
 * Документ описан **минимально достаточно**: генератор не претендует на
 * полноту OpenAPI-спеки, а типизирует ровно то, что выводит из деклараций,
 * плюс поля, которые вызывающий передаёт как есть (`servers`, `security`,
 * `securitySchemes`, `externalDocs`). Всё остальное — `JsonValue`: JSON
 * Schema приходит от конвертера вендора, и переопределять её форму своим
 * типом значило бы притворяться, что генератор её понимает.
 */

import type { DiscoveredEndpoint } from '@nestling/app';
import type { SchemaDocConverter } from '@nestling/pipeline';

/** JSON-значение: всё, что переживает `JSON.parse(JSON.stringify(...))` */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/** Объект JSON Schema (диалект 2020-12 — тот, что отдают конвертеры) */
export type JsonSchemaObject = Readonly<Record<string, JsonValue>>;

/** Секция `info` документа */
export interface OpenApiInfo {
  readonly title: string;
  readonly version: string;
  readonly description?: string;
  readonly termsOfService?: string;
  readonly contact?: JsonValue;
  readonly license?: JsonValue;
}

/** Параметр операции (`in: 'path' | 'query'`) */
export interface OpenApiParameter {
  readonly name: string;
  readonly in: 'path' | 'query';
  readonly required?: boolean;
  readonly description?: string;
  readonly schema: JsonValue;

  /** Сериализация query-параметра: `form` + `explode` — дефолт OpenAPI */
  readonly style?: 'form';
  readonly explode?: boolean;
}

/** Тело запроса или ответа: `content` по media type */
export type OpenApiContent = Readonly<
  Record<string, { readonly schema?: JsonValue }>
>;

/** Тело запроса */
export interface OpenApiRequestBody {
  readonly required: boolean;
  readonly content: OpenApiContent;
}

/** Один ответ операции */
export interface OpenApiResponse {
  readonly description: string;
  readonly content?: OpenApiContent;
}

/** Операция: одна пара «метод + путь» */
export interface OpenApiOperation {
  /** Выводится: имя операции либо слаг от метода и пути */
  readonly operationId: string;

  readonly summary?: string;
  readonly description?: string;
  readonly tags?: readonly string[];
  readonly deprecated?: boolean;

  readonly parameters?: readonly OpenApiParameter[];
  readonly requestBody?: OpenApiRequestBody;

  /** Ключи — коды ответа и `'default'` */
  readonly responses: Readonly<Record<string, OpenApiResponse>>;
}

/** Элемент пути: операции по методам в нижнем регистре */
export type OpenApiPathItem = Readonly<Record<string, OpenApiOperation>>;

/** Документ OpenAPI 3.1 */
export interface OpenApiDocument {
  readonly openapi: '3.1.0';
  readonly info: OpenApiInfo;
  readonly paths: Readonly<Record<string, OpenApiPathItem>>;
  readonly servers?: readonly JsonValue[];
  readonly security?: readonly JsonValue[];
  readonly components?: {
    readonly securitySchemes?: Readonly<Record<string, JsonValue>>;
  };
  readonly externalDocs?: JsonValue;
}

/**
 * Документируемый endpoint: декларация и модуль-объявитель.
 *
 * Структурно совпадает с `DiscoveredEndpoint` discovery (и с
 * `PolicySubject` политик) — тем же приёмом, которым `PolicySubject` уже
 * избегает конвертации между пакетами: результат `discoverEndpoints`
 * скармливается генератору как есть.
 */
export type DocumentedEndpoint = DiscoveredEndpoint;

/** Опции построения документа */
export interface OpenApiOptions {
  /** Секция `info` — единственное обязательное поле */
  readonly info: OpenApiInfo;

  /**
   * Конвертеры листовых схем: список — **данные вызывающего**.
   *
   * Вшитого реестра по вендору не существует; отсутствие конвертера для
   * встреченного вендора — ошибка построения, а не молчаливый пропуск.
   */
  readonly converters?: readonly SchemaDocConverter[];

  /**
   * Серверы документа. Не выводятся из конфигурации транспорта: за
   * прокси значение всё равно было бы неверным.
   */
  readonly servers?: readonly JsonValue[];

  /** Требования безопасности верхнего уровня — переносятся как есть */
  readonly security?: readonly JsonValue[];

  /** `components.securitySchemes` — переносятся как есть */
  readonly securitySchemes?: Readonly<Record<string, JsonValue>>;

  /** `externalDocs` — переносится как есть */
  readonly externalDocs?: JsonValue;
}
