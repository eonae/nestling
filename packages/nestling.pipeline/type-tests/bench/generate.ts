/**
 * Генератор синтетического графа для бюджета типов.
 *
 * Граф генерируется, а не хранится закоммиченными файлами: размер —
 * параметр, а не правка фикстур. Форма повторяет худший случай из замеров
 * change #23 — **вложенная** композиция одним выражением
 * (`compose(compose(…, lN-1), lN)`), потому что дорога именно вложенность,
 * а не длина pre-цепочки.
 */

export interface GraphOptions {
  /** Число слоёв, соединяемых вложенной композицией */
  layers: number;
  /** Число деклараций endpoint'ов поверх собранного пайплайна */
  endpoints: number;
}

/** Позиция курсора в сгенерированном файле (1-based, как в протоколе tsserver) */
export interface Probe {
  line: number;
  offset: number;
}

export interface GeneratedGraph {
  source: string;
  /** Позиция на идентификаторе собранного пайплайна — для `quickinfo` */
  hover: Probe;
  /** Позиция сразу после точки в `composed.bind` — для `completionInfo` */
  completion: Probe;
  /**
   * Номер строки за концом файла: туда дописывается «правка», которой
   * замер инвалидирует кэш tsserver — иначе меряется не работа сервера,
   * а попадание в кэш.
   */
  endLine: number;
}

const HEADER = `/* СГЕНЕРИРОВАНО type-tests/bench/generate.ts — не редактировать */
/* eslint-disable */
import type { AnyInput, PreUnitFn, UnitResolver } from '@nestling/pipeline';
import { compose, makePipeline, Ok } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';

declare const resolve: UnitResolver;
`;

/**
 * Собирает исходник графа: `layers` слоёв, каждый требует поле
 * предыдущего и добавляет своё (проверка требований в точке композиции
 * реально работает), и `endpoints` деклараций поверх результата.
 */
export function generateGraph({
  layers,
  endpoints,
}: GraphOptions): GeneratedGraph {
  if (layers < 2) {
    throw new Error('generateGraph: нужно не меньше двух слоёв');
  }

  const lines: string[] = HEADER.split('\n');

  for (let i = 0; i < layers; i++) {
    lines.push(
      `declare const u${i}: PreUnitFn<AnyInput, { f${i}: string }>;`,
      i === 0
        ? `const l${i} = makePipeline().pre(u${i});`
        : `const l${i} = makePipeline<{ f${i - 1}: string }>().pre(u${i});`,
    );
  }

  // Одно выражение: каждый уровень compose получает результат предыдущего.
  let expression = 'l0';
  for (let i = 1; i < layers; i++) {
    expression = `compose(${expression}, l${i})`;
  }
  lines.push('', `export const composed = ${expression};`);

  for (let i = 0; i < endpoints; i++) {
    lines.push(
      `export const e${i} = httpEndpoint({`,
      `  method: 'GET',`,
      `  path: '/bench/${i}',`,
      `  pipeline: composed,`,
      `  handle: async () => new Ok({ n: ${i} }),`,
      `});`,
    );
  }

  lines.push('');
  const hoverLine = lines.length + 1;
  lines.push(`export const probeHover = composed;`);
  const completionLine = lines.length + 1;
  lines.push(`export const probeCompletion = composed.bind(resolve);`);
  lines.push('');

  return {
    source: lines.join('\n'),
    // Колонка идентификатора `composed` в `export const probeHover = composed;`
    hover: { line: hoverLine, offset: 'export const probeHover = c'.length },
    // Колонка сразу после точки в `composed.bind(...)`
    completion: {
      line: completionLine,
      offset: 'export const probeCompletion = composed.'.length + 1,
    },
    endLine: lines.length + 1,
  };
}

/** База сравнения: пустой файл при том же tsconfig */
export const BASE_SOURCE = `/* СГЕНЕРИРОВАНО type-tests/bench/generate.ts */
export {};
`;
