/**
 * `buildOpenApiDocument` — чистая функция из деклараций в документ.
 *
 * Ни контейнера, ни транспортов, ни поднятого приложения ей не нужно: на
 * входе то же значение, что отдаёт `discoverEndpoints`. Поэтому документ
 * кладётся в артефакты CI тремя строками — и той же функцией пользуется
 * модуль-издатель, когда строит документ на ASSEMBLE.
 */

import { Diagnostics, whereOf } from './diagnostics.js';
import { planInput } from './input.js';
import { planResponses } from './responses.js';
import type { ConvertContext } from './schema.js';
import type {
  DocumentedEndpoint,
  OpenApiDocument,
  OpenApiOperation,
  OpenApiOptions,
  OpenApiPathItem,
} from './types.js';

import type { AnyEndpointDefinition } from '@nestling/pipeline';
import { assertConverters, describeForm } from '@nestling/pipeline';
import { busBindingOf } from '@nestling/ports';
import type { HttpBinding } from '@nestling/transport.http';
import { httpBindingOf, isHttpBinding } from '@nestling/transport.http';

/** Endpoint, отобранный для документа: его карта уже прочитана */
interface Documented {
  readonly endpoint: AnyEndpointDefinition;
  readonly moduleName: string;
  readonly binding: HttpBinding;
}

/**
 * Строит документ OpenAPI 3.1 из деклараций.
 *
 * Документируются только носители HTTP bind-карты: декларации прочих
 * транспортов исключаются молча — HTTP-документ их не описывает. Endpoint,
 * помеченный `doc: { hidden: '<причина>' }`, исключается вместе со своими
 * схемами: это единственный способ не документировать HTTP-endpoint.
 *
 * @param endpoints - Результат `discoverEndpoints(...).endpoints` (или
 * любой структурно совпадающий список)
 * @param options - `info` (обязательно), конвертеры и поля, переносимые
 * в документ как есть
 * @returns JSON-сериализуемый документ
 * @throws {Error} Дубль `(метод, путь)`; непокрытая конвертером схема;
 * path-параметр без свойства в схеме; неразложимый вход. Нарушения
 * перечисляются **все сразу**
 *
 * @example
 * ```typescript
 * const { endpoints } = discoverEndpoints([...features, ...plugins]);
 * writeFileSync('openapi.json', JSON.stringify(
 *   buildOpenApiDocument(endpoints, { info, converters: [zodConverter()] }),
 * ));
 * ```
 */
export function buildOpenApiDocument(
  endpoints: readonly DocumentedEndpoint[],
  options: OpenApiOptions,
): OpenApiDocument {
  assertConverters(options.converters);
  assertInfo(options.info);

  const diagnostics = new Diagnostics();
  const documented = select(endpoints);

  assertUniqueAddresses(documented);

  const paths: Record<string, Record<string, OpenApiOperation>> = {};

  for (const item of documented) {
    const path = openApiPath(item.binding.path);
    const method = item.binding.method.toLowerCase();

    const context: ConvertContext = {
      converters: options.converters,
      diagnostics,
      where: whereOf(item.endpoint.pattern, item.moduleName),
    };

    (paths[path] ??= {})[method] = operationOf(item, context);
  }

  // Тотальность: все нарушения приложения — одним броском, а не первое
  // попавшееся
  diagnostics.throwIfAny();

  return {
    openapi: '3.1.0',
    info: options.info,
    ...(options.servers === undefined ? {} : { servers: options.servers }),
    ...(options.security === undefined ? {} : { security: options.security }),
    ...(options.securitySchemes === undefined
      ? {}
      : { components: { securitySchemes: options.securitySchemes } }),
    ...(options.externalDocs === undefined
      ? {}
      : { externalDocs: options.externalDocs }),
    paths: paths as Readonly<Record<string, OpenApiPathItem>>,
  };
}

/** Fail-fast словаря опций: без `info` документ невалиден по спеке */
function assertInfo(info: unknown): void {
  const title = (info as { title?: unknown } | undefined)?.title;
  const version = (info as { version?: unknown } | undefined)?.version;

  if (typeof title !== 'string' || typeof version !== 'string') {
    throw new TypeError(
      `buildOpenApiDocument(…, { info }): 'info' must carry a 'title' and a ` +
        `'version' — both are required by the OpenAPI specification.`,
    );
  }
}

/** Отбор: HTTP-носители минус скрытые */
function select(endpoints: readonly DocumentedEndpoint[]): Documented[] {
  const documented: Documented[] = [];

  for (const { endpoint, moduleName } of endpoints) {
    if (!isHttpBinding(endpoint.binding)) {
      continue;
    }

    // Скрытый endpoint выпадает вместе со своими схемами: проверять на
    // конвертируемость то, чего в документе нет, незачем
    if (endpoint.doc?.hidden !== undefined) {
      continue;
    }

    documented.push({ endpoint, moduleName, binding: httpBindingOf(endpoint) });
  }

  return documented;
}

/**
 * Дубль `(метод, путь)` — ошибка, а не последняя выигравшая операция.
 *
 * Бросается отдельно от копилки диагностик: с двумя endpoint'ами на одном
 * адресе документ построить нечем, и продолжать разбор схем бессмысленно.
 */
function assertUniqueAddresses(documented: readonly Documented[]): void {
  const seen = new Map<string, Documented>();

  for (const item of documented) {
    const key = `${item.binding.method} ${openApiPath(item.binding.path)}`;
    const first = seen.get(key);

    if (first) {
      throw new Error(
        `Two endpoints answer '${key}': ` +
          `'${first.endpoint.pattern}' (module '${first.moduleName}') and ` +
          `'${item.endpoint.pattern}' (module '${item.moduleName}'). ` +
          `One address is one operation — give one of them a different path.`,
      );
    }

    seen.set(key, item);
  }
}

/** Шаблон пути OpenAPI: `:param` → `{param}` */
export function openApiPath(path: string): string {
  return path
    .split('/')
    .map((segment) =>
      segment.startsWith(':') ? `{${segment.slice(1)}}` : segment,
    )
    .join('/');
}

/**
 * Имя операции **выводится, а не объявляется**.
 *
 * Имя операции, если декларация служит операции (его несёт bind-карта, а
 * у реализации на шине — bus-биндинг), иначе детерминированный слаг от
 * метода и шаблона пути. Ручное имя не нужно, пока имя операции уникально
 * по построению, а адрес уникален проверкой выше.
 */
export function operationIdOf(
  endpoint: AnyEndpointDefinition,
  binding: HttpBinding,
): string {
  const bus = busBindingOf(endpoint)?.subject;
  if (bus !== undefined) {
    return bus;
  }

  if (binding.contract !== undefined) {
    return binding.contract;
  }

  const segments = binding.path
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) =>
      segment.replace(/^:/, '').replaceAll(/[^\dA-Za-z]+/g, '_'),
    );

  return [
    binding.method.toLowerCase(),
    ...(segments.length > 0 ? segments : ['root']),
  ].join('_');
}

/** Одна операция: адрес, документация, вход и ответы */
function operationOf(
  item: Documented,
  context: ConvertContext,
): OpenApiOperation {
  const { endpoint, binding } = item;
  const doc = endpoint.doc;

  const { parameters, requestBody } = planInput(
    endpoint.input,
    binding,
    context,
  );

  const responses = planResponses(
    {
      output: endpoint.output,
      errors: endpoint.errors,
      doc,
      hasInputSchema: describeForm(endpoint.input).leaf !== undefined,
    },
    context,
  );

  return {
    operationId: operationIdOf(endpoint, binding),
    ...(doc?.summary === undefined ? {} : { summary: doc.summary }),
    ...(doc?.description === undefined ? {} : { description: doc.description }),
    ...(doc?.tags === undefined ? {} : { tags: doc.tags }),
    ...(doc?.deprecated === undefined ? {} : { deprecated: doc.deprecated }),
    ...(parameters.length > 0 ? { parameters } : {}),
    ...(requestBody === undefined ? {} : { requestBody }),
    responses,
  };
}

/**
 * Скрытые endpoint'ы с их причинами — поверхность для аудита.
 *
 * В документ список не попадает: документ уходит наружу, а «что мы решили
 * не показывать» это внутреннее знание. Печатает его модуль-издатель на
 * старте, рядом со списком detached-endpoint'ов.
 */
export function hiddenEndpoints(
  endpoints: readonly DocumentedEndpoint[],
): readonly { pattern: string; moduleName: string; reason: string }[] {
  return endpoints
    .filter(
      ({ endpoint }) =>
        isHttpBinding(endpoint.binding) && endpoint.doc?.hidden !== undefined,
    )
    .map(({ endpoint, moduleName }) => ({
      pattern: endpoint.pattern,
      moduleName,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      reason: endpoint.doc!.hidden!,
    }));
}
