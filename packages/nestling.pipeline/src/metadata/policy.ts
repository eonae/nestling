/**
 * Словарь инвариантов сборки: `everyEndpoint(...).hasLayer(...)`.
 *
 * Живёт в ядре, потому что оперирует ровно двумя его понятиями —
 * декларацией (`EndpointDefinition`, `TransportRef`) и пайплайном
 * (провенанс композиции). Прогоняет политики `@nestling/app`: он собирает
 * субъекты из дискавери, зовёт `check` и форматирует нарушения, но в
 * содержимое политики не заглядывает.
 */

import { derivesFrom } from '../core';

import type { AnyEndpointDefinition, TransportRef } from './endpoint';
import { transportNameOf } from './endpoint';

/**
 * Ручка, попавшая под проверку: декларация и её модуль-объявитель.
 *
 * Форма выбрана структурно совпадающей с `DiscoveredEndpoint` дискавери —
 * конвертации между пакетами не требуется.
 */
export interface PolicySubject {
  readonly endpoint: AnyEndpointDefinition;
  readonly moduleName: string;
}

/** Нарушение: что именно и на какой ручке */
export interface PolicyViolation {
  /** Паттерн декларации — то же, что увидит транспорт */
  readonly pattern: string;

  /** Имя транспорта ручки */
  readonly transport: string;

  /** Модуль, объявивший ручку в `endpoints:` */
  readonly moduleName: string;

  /** Суть нарушения одной фразой — хвост строки диагностики */
  readonly detail: string;
}

/**
 * Инвариант приложения — **значение**, а не имя или конфиг.
 *
 * Интерфейс открытый: новый предикат приезжает значением того же типа и
 * проверяется тем же прогоном, без второго обхода дискавери и без второго
 * поля в корне.
 */
export interface Policy {
  /** Описание для текста диагностики: «every http endpoint has layer …» */
  describe(): string;

  /** Нарушения среди переданных ручек; пустой массив — политика соблюдена */
  check(subjects: readonly PolicySubject[]): readonly PolicyViolation[];
}

/**
 * Фильтр множества ручек.
 *
 * Оба поля опциональны и сужают множество конъюнктивно; пустой фильтр —
 * все ручки приложения.
 */
export interface EndpointFilter {
  /**
   * Токен транспорта (`HttpTransport$`), сравнение — по ссылке.
   *
   * Строковое имя не принимается: множество транспортов приложения
   * выводится из графа, и идентичность здесь та же, что у декларации.
   */
  transport?: TransportRef;

  /**
   * Регулярное выражение по строке `endpoint.pattern`
   * (`'POST /api/users'`, `'process-stdin'`).
   *
   * Строка не принимается намеренно: «строка — это префикс?» — ровно тот
   * implicit, которого дизайн не допускает.
   */
  pattern?: RegExp;
}

/** Билдер политик над отфильтрованным множеством ручек */
export interface EndpointPolicyBuilder {
  /**
   * Каждая ручка под фильтром композирована от значения-слоя.
   *
   * Идентичность слоя — **ссылочная**: совпадение определяется провенансом
   * композиции (`compose`, деривация билдера, `bind`), а не именем, юнитами
   * или структурой. Ручка без пайплайна нарушает: «нет пайплайна» и «нет
   * слоя» для инварианта неразличимы.
   *
   * @param layer - Само значение-слой, от которого требуется происхождение
   * @param label - Человекочитаемая метка **только** для диагностики;
   * вывод имени из переменной или стека — runtime magic, его нет
   */
  hasLayer(layer: unknown, label?: string): Policy;
}

/** Описание фильтра для текста диагностики */
function describeFilter(filter: EndpointFilter): string {
  const parts: string[] = [];

  if (filter.transport !== undefined) {
    parts.push(`transport '${transportNameOf(filter.transport)}'`);
  }
  if (filter.pattern !== undefined) {
    parts.push(`pattern ${String(filter.pattern)}`);
  }

  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}

/** Нарушение на конкретной ручке: координаты берутся с декларации */
function violationOf(subject: PolicySubject, detail: string): PolicyViolation {
  return {
    pattern: subject.endpoint.pattern,
    transport: transportNameOf(subject.endpoint.transport),
    moduleName: subject.moduleName,
    detail,
  };
}

/** Fail-fast фильтра: правила те же, что у словаря декларации */
function assertFilter(filter: EndpointFilter): void {
  if (filter.pattern !== undefined && !(filter.pattern instanceof RegExp)) {
    throw new TypeError(
      `everyEndpoint({ … }): 'pattern' must be a RegExp matched against the ` +
        `endpoint pattern (for example /^\\w+ \\/admin\\//), not a string.`,
    );
  }
}

/**
 * Универсальное утверждение над обнаруженными ручками.
 *
 * Проверяются ручки **выбранной топологии**: источник субъектов — дискавери
 * по дереву зарегистрированных модулей, поэтому ручка невыбранной фичи в
 * проверку не попадает вовсе.
 *
 * @param filter - Сужение множества: токен транспорта и/или RegExp по паттерну
 * @returns Билдер, чьи методы возвращают готовую политику
 *
 * @example
 * ```typescript
 * assemble({
 *   features: [UsersFeature],
 *   transports: [http()],
 *   policies: [
 *     everyEndpoint({ transport: HttpTransport$ })
 *       .hasLayer(authedBase, 'authedBase'),
 *   ],
 * });
 * ```
 */
export function everyEndpoint(
  filter: EndpointFilter = {},
): EndpointPolicyBuilder {
  assertFilter(filter);

  const matches = ({ endpoint }: PolicySubject): boolean => {
    if (
      filter.transport !== undefined &&
      endpoint.transport !== filter.transport
    ) {
      return false;
    }
    if (
      filter.pattern !== undefined &&
      !filter.pattern.test(endpoint.pattern)
    ) {
      return false;
    }
    return true;
  };

  /**
   * Ручки под политикой: фильтр минус opt-out.
   *
   * Detached отсеивается **до** предиката: opt-out тотален, а причина уже
   * объявлена значением и напечатана на старте.
   */
  const subjectsUnder = (
    subjects: readonly PolicySubject[],
  ): readonly PolicySubject[] =>
    subjects.filter(
      (subject) =>
        matches(subject) &&
        (subject.endpoint.detached ?? '').trim().length === 0,
    );

  return {
    hasLayer(layer: unknown, label?: string): Policy {
      const named = label ? `layer '${label}'` : 'the required layer';

      return {
        describe: () => `every endpoint${describeFilter(filter)} has ${named}`,

        check: (subjects) =>
          subjectsUnder(subjects).flatMap((subject) => {
            const { pipeline } = subject.endpoint;

            if (pipeline === undefined) {
              return [
                violationOf(
                  subject,
                  `it declares no pipeline, so it cannot be composed from ${named}`,
                ),
              ];
            }

            return derivesFrom(pipeline, layer)
              ? []
              : [
                  violationOf(
                    subject,
                    `its pipeline is not composed from ${named}`,
                  ),
                ];
          }),
      };
    },
  };
}
