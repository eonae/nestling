/**
 * Словарь инвариантов сборки: `everyEndpoint(...).hasLayer(...)`.
 *
 * Живёт в ядре, потому что оперирует ровно двумя его понятиями —
 * декларацией (`EndpointDefinition`, `TransportRef`) и пайплайном
 * (провенанс композиции). Прогоняет политики `@nestling/app`: он собирает
 * субъекты из discovery, зовёт `check` и форматирует нарушения, но в
 * содержимое политики не заглядывает.
 */

import type { AnyContextVar } from '../core';
import { declaresVar, derivesFrom } from '../core';

import type { AnyEndpointDefinition, TransportRef } from './endpoint';
import { transportNameOf } from './endpoint';

/**
 * Endpoint, попавший под проверку: декларация и её модуль-объявитель.
 *
 * Форма структурно совпадает с `DiscoveredEndpoint` из discovery,
 * поэтому конвертация между пакетами не нужна.
 */
export interface PolicySubject {
  readonly endpoint: AnyEndpointDefinition;
  readonly moduleName: string;
}

/** Нарушение: что именно и на каком endpoint'е */
export interface PolicyViolation {
  /** Паттерн декларации — то же, что увидит транспорт */
  readonly pattern: string;

  /** Имя транспорта endpoint'а */
  readonly transport: string;

  /** Модуль, объявивший endpoint в `endpoints:` */
  readonly moduleName: string;

  /** Суть нарушения одной фразой — хвост строки диагностики */
  readonly detail: string;
}

/**
 * Инвариант приложения — **значение**, а не имя или конфиг.
 *
 * Интерфейс открытый: новый предикат добавляется значением того же типа
 * и проверяется тем же прогоном, без второго обхода discovery и без
 * второго поля в корне.
 */
export interface Policy {
  /** Описание для текста диагностики: «every http endpoint has layer …» */
  describe(): string;

  /**
   * Нарушения среди переданных endpoint'ов.
   * Пустой массив означает, что политика соблюдена.
   */
  check(subjects: readonly PolicySubject[]): readonly PolicyViolation[];
}

/**
 * Фильтр множества endpoint'ов.
 *
 * Оба поля опциональны и сужают множество конъюнктивно. Пустой фильтр
 * даёт все endpoint'ы приложения.
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
   * Строка не принимается: вопрос «это префикс?» стал бы неявным
   * правилом, а дизайн такого не допускает.
   */
  pattern?: RegExp;
}

/** Билдер политик над отфильтрованным множеством endpoint'ов */
export interface EndpointPolicyBuilder {
  /**
   * Каждый endpoint под фильтром композирован от значения-слоя.
   *
   * Идентичность слоя — **ссылочная**: совпадение определяется провенансом
   * композиции (`compose`, деривация билдера, `bind`), а не именем, юнитами
   * или структурой. Endpoint без пайплайна нарушает: «нет пайплайна» и
   * «нет слоя» для инварианта неразличимы.
   *
   * @param layer - Само значение-слой, от которого требуется происхождение
   * @param label - Человекочитаемая метка **только** для диагностики. Имя
   * из переменной или стека фреймворк не выводит
   */
  hasLayer(layer: unknown, label?: string): Policy;

  /**
   * Каждый endpoint под фильтром **объявил** ambient-переменную: его
   * пайплайн содержит pre-юнит формы `<Var>.provide(…)`.
   *
   * Требование объявляется явно, значением. Автоматического вывода «кто-то
   * в поддереве инжектит `Ctx(X)`, поэтому endpoint обязан класть X» в V1
   * нет. Идентичность переменной ссылочная, как и у слоя: одноимённая
   * переменная из другого вызова `contextVar` политику не удовлетворяет.
   * Endpoint без пайплайна нарушает: «нет пайплайна» и «нет переменной»
   * для инварианта неразличимы.
   *
   * @param variable - Само значение переменной (`contextVar<T>()('key')`)
   * @param label - Человекочитаемая метка **только** для диагностики. Без
   * неё диагностика называет ключ переменной
   */
  hasVar(variable: AnyContextVar, label?: string): Policy;
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

/** Нарушение на конкретном endpoint'е: координаты берутся с декларации */
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
 * Универсальное утверждение над обнаруженными endpoint'ами.
 *
 * Проверяются endpoint'ы **выбранной топологии**: источник субъектов —
 * discovery по дереву зарегистрированных модулей, поэтому endpoint
 * невыбранной фичи в проверку не попадает вовсе.
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
   * Endpoint'ы под политикой: фильтр минус opt-out.
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

    hasVar(variable: AnyContextVar, label?: string): Policy {
      const named = `context variable '${label ?? variable.key}'`;
      const fix =
        `compose a layer with <Var>.provide(…) into its 'pipeline:', or ` +
        `opt out with detached: '<reason>'`;

      return {
        describe: () =>
          `every endpoint${describeFilter(filter)} declares ${named}`,

        check: (subjects) =>
          subjectsUnder(subjects).flatMap((subject) => {
            const { pipeline } = subject.endpoint;

            if (pipeline === undefined) {
              return [
                violationOf(
                  subject,
                  `it declares no pipeline, so it cannot declare ${named} — ${fix}`,
                ),
              ];
            }

            return declaresVar(pipeline, variable)
              ? []
              : [
                  violationOf(
                    subject,
                    `its pipeline does not declare ${named} — ${fix}`,
                  ),
                ];
          }),
      };
    },
  };
}
