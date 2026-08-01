/**
 * `openapi(...)` — параметризованный модуль-издатель.
 *
 * Нового примитива «плагин» не заводится: инфраструктура оформляется
 * обычным модулем-значением с параметрами, ровно как `logging({ service })`
 * в примерах. Наружу выходит `Module`, и дискавери, политики, визуализация
 * и pipeline работают с ним как с любым другим.
 *
 * Boot-time-гарантия отдельным кодом **не пишется** — она следствие жадного
 * контейнера: фабрика провайдера зовётся на фазе 1 ASSEMBLE, поэтому любая
 * диагностика генератора роняет сборку там же, где падают все прочие
 * структурные сверки — до `@OnInit` и до `serve`. Ленивого построения нет и
 * не будет: оно уничтожило бы ровно ту гарантию, ради которой всё
 * затевалось.
 */

/* eslint-disable no-console */

import { buildOpenApiDocument, hiddenEndpoints } from './document.js';
import type { OpenApiDocument, OpenApiOptions } from './types.js';

import type { AppModule, EndpointDiscovery } from '@nestling/app';
import { Discovery$, makeAppModule } from '@nestling/app';
import type { InjectionToken } from '@nestling/container';
import { factoryProvider, makeToken } from '@nestling/container';
import type { AnyInput, Pipeline } from '@nestling/pipeline';
import { Ok } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';

/**
 * Токен готового документа.
 *
 * Публичен намеренно: документ бывает нужен не только своей ручке — его
 * инжектируют, чтобы отдать в другом формате, положить в артефакт или
 * сверить в тесте.
 */
export const OpenApiDocument$: InjectionToken<OpenApiDocument> =
  makeToken<OpenApiDocument>('nestling:openapi:document');

/**
 * Как модуль отдаёт документ наружу.
 *
 * Параметры пайплайна вынесены в тип-аргументы, потому что слой приложения
 * приезжает со своими требованиями к контексту и своими классами-юнитами:
 * зафиксировать их здесь значило бы отвергать законный `observability`.
 */
export interface OpenApiServeOptions<
  P extends AnyInput = AnyInput,
  PN = never,
> {
  /** Путь ручки; по умолчанию `/openapi.json` */
  readonly path?: string;

  /**
   * Pipeline собственной ручки модуля.
   *
   * Обязателен как **возможность**: приложение вправе требовать политикой
   * слой на каждой HTTP-ручке (`everyEndpoint(...).hasLayer(observability)`),
   * а satellite-модуль про этот слой ничего не знает. Без этой опции
   * подключение модуля роняло бы `policies` — и это была бы наша проблема,
   * а не пользователя.
   */
  readonly pipeline?: Pipeline<AnyInput, P, PN>;

  /** Причина вывода собственной ручки из-под инвариантов сборки */
  readonly detached?: string;

  /**
   * Печатать ли на старте список скрытых ручек с причинами.
   *
   * По умолчанию печатает: `doc.hidden` — тотальный opt-out, и он обязан
   * быть поверхностью для аудита, как список detached-ручек. В самом
   * документе списка нет: документ уходит наружу.
   */
  readonly announceHidden?: boolean;
}

/**
 * Модуль, строящий документ на ASSEMBLE и отдающий его ручкой.
 *
 * @param options - Опции документа плюс опции подачи (`path`, `pipeline`,
 * `detached`)
 * @returns Обычный модуль-значение для `modules:` корня
 *
 * @example
 * ```typescript
 * assemble({
 *   features: [UsersFeature],
 *   modules: [openapi({
 *     info: { title: 'Users API', version: '1.0.0' },
 *     converters: [zodConverter()],
 *     pipeline: observabilityBase,
 *   })],
 *   transports: [http({ port: 3000 })],
 * });
 * ```
 */
export function openapi<P extends AnyInput = AnyInput, PN = never>(
  options: OpenApiOptions & OpenApiServeOptions<P, PN>,
): AppModule {
  const { path, pipeline, detached, announceHidden, ...documentOptions } =
    options;

  const document = httpEndpoint({
    method: 'GET',
    path: path ?? '/openapi.json',
    ...(pipeline === undefined ? {} : { pipeline }),
    ...(detached === undefined ? {} : { detached }),
    // Документ не описывает сам себя: ручка служебная, и в списке операций
    // API ей делать нечего
    doc: { hidden: 'служебная ручка: сам документ' },
    deps: [OpenApiDocument$],
    handle: (value: OpenApiDocument) => async () => new Ok(value),
  });

  return makeAppModule({
    name: 'module:openapi',
    providers: [
      factoryProvider(
        OpenApiDocument$,
        (discovery: EndpointDiscovery) =>
          build(discovery, documentOptions, announceHidden ?? true),
        [Discovery$],
      ),
    ],
    endpoints: [document],
    exports: [OpenApiDocument$],
  });
}

/** Строит документ и печатает список скрытых ручек */
function build(
  discovery: EndpointDiscovery,
  options: OpenApiOptions,
  announceHidden: boolean,
): OpenApiDocument {
  if (announceHidden) {
    for (const { pattern, moduleName, reason } of hiddenEndpoints(
      discovery.endpoints,
    )) {
      console.log(
        `[nestling] hidden from the API document: ${pattern} ` +
          `(module '${moduleName}') — ${reason}`,
      );
    }
  }

  return buildOpenApiDocument(discovery.endpoints, options);
}
