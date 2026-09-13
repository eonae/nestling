/**
 * `openapi(...)` — параметризованный плагин-издатель.
 *
 * Новых механизмов роль плагина не приносит: инфраструктура остаётся
 * значением с параметрами, ровно как `logging({ service })` в примерах.
 * Наружу выходит `Plugin`, и discovery, политики, визуализация и pipeline
 * работают с ним как с любой другой единицей. Endpoint у плагина законен:
 * служебный endpoint с документом — та же инфраструктура.
 *
 * Гарантия на старте отдельным кодом **не пишется** — она следствие жадного
 * контейнера: фабрика провайдера зовётся на фазе 1 BUILD, поэтому любая
 * диагностика генератора роняет сборку там же, где падают все прочие
 * структурные сверки — до INIT и до `serve`. Ленивого построения нет и
 * не будет: оно уничтожило бы ровно ту гарантию, ради которой всё
 * затевалось.
 */

import { buildDocument, hiddenEndpoints } from './document.js';
import type { OpenApiDocument, OpenApiOptions } from './types.js';

import type {
  AnyInput,
  EndpointDiscovery,
  Logger,
  Pipeline,
  Plugin,
} from '@nestlingjs/app';
import { Discovery$, Logger$, makePlugin, Ok } from '@nestlingjs/app';
import type { InjectionToken } from '@nestlingjs/container';
import { factoryProvider, Handler, makeToken } from '@nestlingjs/container';
import { httpEndpoint } from '@nestlingjs/transport.http';

/**
 * DI-токен готового документа.
 *
 * Публичен намеренно: документ бывает нужен не только своему endpoint'у —
 * его инжектируют, чтобы отдать в другом формате, положить в артефакт или
 * сверить в тесте.
 */
export const OpenApiDocument$: InjectionToken<OpenApiDocument> =
  makeToken<OpenApiDocument>('nestling:openapi:document');

/**
 * Как модуль отдаёт документ наружу.
 *
 * Параметры пайплайна вынесены в тип-аргументы, потому что слой приложения
 * приходит со своими требованиями к контексту и своими классами-шагами:
 * зафиксировать их здесь значило бы отвергать законный `observability`.
 */
export interface OpenApiServeOptions<
  P extends AnyInput = AnyInput,
  PN = never,
> {
  /** Путь endpoint'а; по умолчанию `/openapi.json` */
  readonly path?: string;

  /**
   * Pipeline собственного endpoint'а модуля.
   *
   * Обязателен как **возможность**: приложение может требовать политикой
   * слой на каждом HTTP-endpoint'е
   * (`everyEndpoint(...).hasLayer(observability)`), а satellite-модуль про
   * этот слой ничего не знает. Без этой опции подключение модуля роняло бы
   * `policies` — и это была бы наша проблема, а не пользователя.
   */
  readonly pipeline?: Pipeline<AnyInput, P, PN>;

  /** Причина вывода собственного endpoint'а из-под инвариантов сборки */
  readonly detached?: string;

  /**
   * Писать ли на старте список скрытых endpoint'ов с причинами в логгер
   * ядра (`Logger$('nestling:openapi')`, уровень `info`).
   *
   * По умолчанию пишет: `doc.hidden` — тотальный opt-out, и он обязан
   * быть поверхностью для аудита, как список detached-endpoint'ов. В самом
   * документе списка нет: документ уходит наружу.
   */
  readonly announceHidden?: boolean;
}

/**
 * Плагин документации: обычная единица состава плюс метод построения.
 *
 * Опции документа у плагина уже есть, поэтому документ для артефактов
 * сборки строится тем же значением: второго словаря опций рядом с
 * декларацией не заводится, и `info` записан ровно в одном месте.
 */
export interface OpenApiPlugin extends Plugin {
  /**
   * Строит документ из результата `app.discover(args?)`.
   *
   * Ни контейнера, ни транспортов, ни поднятого приложения не требуется.
   * Метод работает и тогда, когда плагин не попал в состав: значение живёт
   * в декларации приложения, а ветка переключателя решает только судьбу
   * endpoint'а `GET /openapi.json`.
   *
   * @param discovery - Результат `app.discover(args?)`
   * @returns JSON-сериализуемый документ OpenAPI 3.1
   */
  document(discovery: EndpointDiscovery): OpenApiDocument;
}

/**
 * Плагин, строящий документ на BUILD и отдающий его endpoint'ом.
 *
 * @param options - Опции документа плюс опции подачи (`path`, `pipeline`,
 * `detached`)
 * @returns Значение-плагин для `plugins:` корня; у него же метод
 * `document(discovery)`
 *
 * @example
 * ```typescript
 * export const appOpenapi = openapi({
 *   info: { title: 'Users API', version: '1.0.0' },
 *   pipeline: observabilityBase,
 * });
 *
 * build({
 *   features: [UsersFeature],
 *   plugins: [appOpenapi],
 *   transports: [http()],
 * });
 *
 * // Тот же документ для артефактов сборки, без поднятия приложения:
 * appOpenapi.document(app.discover(args));
 * ```
 */
export function openapi<P extends AnyInput = AnyInput, PN = never>(
  options: OpenApiOptions & OpenApiServeOptions<P, PN>,
): OpenApiPlugin {
  const { path, pipeline, detached, announceHidden, ...documentOptions } =
    options;

  @Handler([OpenApiDocument$])
  class DocumentHandler {
    constructor(private readonly document: OpenApiDocument) {}

    async handle() {
      return new Ok(this.document);
    }
  }

  const document = httpEndpoint.get(path ?? '/openapi.json', {
    ...(pipeline === undefined ? {} : { pipeline }),
    ...(detached === undefined ? {} : { detached }),
    // Документ не описывает сам себя: endpoint служебный, и в списке операций
    // API ей делать нечего
    doc: { hidden: 'service endpoint: the document itself' },
    handler: DocumentHandler,
  });

  const plugin = makePlugin({
    name: '@nestlingjs/openapi',
    providers: [
      factoryProvider(
        OpenApiDocument$,
        (discovery: EndpointDiscovery, logger: Logger) =>
          build(discovery, documentOptions, announceHidden ?? true, logger),
        [Discovery$, Logger$('nestling:openapi')],
      ),
    ],
    endpoints: [document],
  });

  // Метод и провайдер зовут одну функцию: документ из артефактов сборки и
  // документ по `GET /openapi.json` совпадают по построению
  return Object.freeze({
    ...plugin,
    document: (discovery: EndpointDiscovery) =>
      buildDocument(discovery.endpoints, documentOptions),
  });
}

/** Строит документ и пишет в логгер список скрытых endpoint'ов */
function build(
  discovery: EndpointDiscovery,
  options: OpenApiOptions,
  announceHidden: boolean,
  logger: Logger,
): OpenApiDocument {
  if (announceHidden) {
    for (const { pattern, moduleName, reason } of hiddenEndpoints(
      discovery.endpoints,
    )) {
      logger.info('hidden from the API document', {
        pattern,
        module: moduleName,
        reason,
      });
    }
  }

  return buildDocument(discovery.endpoints, options);
}
