/**
 * `import-through-barrel` — импорт входит внутрь чужого модуля мимо его
 * бареля.
 *
 * Модуль правило узнаёт по файловой системе: **папка с баррель-файлом
 * (`index.*`) — это модуль, а сам баррель — его публичная поверхность.**
 * Папка без бареля границей не является, и правило про неё молчит.
 *
 * Отсюда единственная проверка: пересечь границу модуля снаружи внутрь
 * можно только через его баррель. Два вида импортов границу не пересекают
 * и потому разрешены всегда:
 *
 * - **сосед в своей папке** (`./container.builder.js`) — модуль имеет право
 *   на внутреннее устройство; требовать здесь баррель значило бы завести
 *   цикл `a.ts → index.ts → a.ts`, который ловит `import/no-cycle`;
 * - **импорт вверх, к предку** (`../types.js` из вложенной папки) — предок
 *   уже содержит импортёра, и его граница им не пересекается.
 *
 * Межпакетные импорты правило не смотрит: `@nestling/*` резолвит Node по
 * полю `exports` пакета, и неперечисленный путь физически недоступен. Там
 * гарантия уже есть, и вторая проверка ничего не добавила бы.
 *
 * В отличие от `endpoint-has-layer`, правило полно: спецификаторы импорта —
 * литералы, и обойти проверку можно лишь вычисляемым `import()`, про
 * который правило молчит осознанно.
 */

import { readFileSync, statSync } from 'node:fs';
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path';

import type { Rule } from 'eslint';
import type { Node } from 'estree';

/**
 * Опции правила.
 *
 * Дефолты выбраны так, чтобы правило без настройки означало ровно своё имя:
 * никаких послаблений, кроме молчания на непрозрачном коде.
 */
interface Options {
  /**
   * Разрешить `import type` пересекать границу.
   *
   * По умолчанию нет. Типовой импорт компилятор стирает, и цикла он не
   * создаёт — но он же и есть основной способ узнать про внутреннее
   * устройство чужого модуля, а правило охраняет именно его.
   */
  allowTypeImports: boolean;

  /**
   * Файлы, которым можно смотреть внутрь модулей: глобы по пути импортёра.
   *
   * Это точки входа пакета — файлы за собственной записью `exports`, чья
   * задача как раз собрать поверхность из внутренних листьев, минуя барель.
   * Пример из репозитория — `@nestling/container/tokens`: барель пакета
   * втянул бы билдер графа, поэтому subpath берёт `providers/token-family`
   * напрямую.
   */
  entrypoints: string[];

  /**
   * Разрешённые цели: глобы по пути импортируемого файла.
   *
   * Матчится цель, а не спецификатор: один и тот же модуль пишется
   * по-разному из разных папок, и глоб по спецификатору пришлось бы
   * заводить на каждого импортёра.
   */
  allow: string[];

  /**
   * Что делать, когда баррель модуля не реэкспортирует цель.
   *
   * Такой импорт починить заменой пути нельзя: модуль приватен для своей
   * папки. `'report'` говорит это отдельным текстом, `'allow'` молчит —
   * послабление на время разбора накопленного.
   */
  onMissingReexport: 'report' | 'allow';

  /** Проверять ли `import()` с литеральным путём */
  checkDynamicImports: boolean;
}

const DEFAULTS: Options = {
  allowTypeImports: false,
  entrypoints: [],
  allow: [],
  onMissingReexport: 'report',
  checkDynamicImports: true,
};

/**
 * Расширения, которыми правило достраивает спецификатор.
 *
 * TypeScript-варианты идут первыми: в ESM-репозитории `./store.js` — это
 * ссылка на `store.ts`, и найти надо исходник, а не собранный файл.
 */
const EXTENSIONS = [
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
];

/** Спецификатор `./store.js` указывает на `store.ts` — карта обратной замены */
const JS_TO_TS: ReadonlyMap<string, readonly string[]> = new Map([
  ['.js', ['.ts', '.tsx']],
  ['.mjs', ['.mts']],
  ['.cjs', ['.cts']],
]);

/** Насколько глубоко разворачиваются цепочки реэкспортов */
const REEXPORT_DEPTH = 8;

// ---------------------------------------------------------------------------
// Файловая система: кэш живёт на процесс
// ---------------------------------------------------------------------------

/*
 * Правилу нужны факты о диске — есть ли в папке баррель, что он
 * реэкспортирует, — и оно спрашивает их для каждого импорта. Без кэша это
 * тысячи `stat` на прогон монорепы.
 *
 * Кэш модульный, а не пожизненный на `create()`: ESLint зовёт `create` на
 * каждый файл, и кэш, живущий один файл, не окупается. Цена — редактор в
 * watch-режиме не заметит только что созданный баррель до перезапуска
 * ESLint-сервера.
 */

type Kind = 'file' | 'directory' | 'missing';

const statCache = new Map<string, Kind>();

function kindOf(path: string): Kind {
  const cached = statCache.get(path);
  if (cached) {
    return cached;
  }

  let kind: Kind;
  try {
    kind = statSync(path).isDirectory() ? 'directory' : 'file';
  } catch {
    kind = 'missing';
  }

  statCache.set(path, kind);

  return kind;
}

const barrelCache = new Map<string, string | undefined>();

/** Путь к баррелю папки, если он есть */
function barrelOf(directory: string): string | undefined {
  if (barrelCache.has(directory)) {
    return barrelCache.get(directory);
  }

  let barrel: string | undefined;
  for (const extension of EXTENSIONS) {
    const candidate = resolve(directory, `index${extension}`);
    if (kindOf(candidate) === 'file') {
      barrel = candidate;
      break;
    }
  }

  barrelCache.set(directory, barrel);

  return barrel;
}

const sourceCache = new Map<string, string>();

function readSource(path: string): string {
  const cached = sourceCache.get(path);
  if (cached !== undefined) {
    return cached;
  }

  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    text = '';
  }

  sourceCache.set(path, text);

  return text;
}

// ---------------------------------------------------------------------------
// Резолв спецификатора
// ---------------------------------------------------------------------------

/** Спецификатор относительный, то есть указывает внутрь пакета */
const isRelative = (specifier: string): boolean =>
  specifier === '.' ||
  specifier === '..' ||
  specifier.startsWith('./') ||
  specifier.startsWith('../');

/** Файл — сам баррель, и разбирать чужие внутренности его работа */
const isBarrelFile = (path: string): boolean =>
  EXTENSIONS.some((extension) => basename(path) === `index${extension}`);

/**
 * Файл, на который указывает спецификатор.
 *
 * `'directory'` — импорт папки, то есть обращение к её баррелю: цели у него
 * нет, и проверять нечего. `undefined` — спецификатор не резолвится
 * (сгенерированное, отсутствующее); правило молчит.
 */
function resolveTarget(
  fromDirectory: string,
  specifier: string,
): { file: string } | 'directory' | undefined {
  const candidate = resolve(fromDirectory, specifier);
  const kind = kindOf(candidate);

  if (kind === 'directory') {
    return 'directory';
  }

  if (kind === 'file') {
    return { file: candidate };
  }

  const extension = EXTENSIONS.find((value) => candidate.endsWith(value));

  if (extension) {
    for (const replacement of JS_TO_TS.get(extension) ?? []) {
      const stem = candidate.slice(0, -extension.length);
      if (kindOf(stem + replacement) === 'file') {
        return { file: stem + replacement };
      }
    }

    return undefined;
  }

  for (const value of EXTENSIONS) {
    if (kindOf(candidate + value) === 'file') {
      return { file: candidate + value };
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Граница модуля
// ---------------------------------------------------------------------------

const isInside = (path: string, directory: string): boolean =>
  path.startsWith(directory + sep);

/**
 * Самая внешняя граница модуля, которую импорт пересекает снаружи внутрь.
 *
 * Берётся именно внешняя, а не ближайшая к цели: снаружи модуля его
 * внутреннее устройство не видно вовсе, и вложенный баррель законной точкой
 * входа для чужака не является.
 *
 * Подъём останавливается на папке с `package.json`: выше начинается чужой
 * пакет, а его границу стережёт поле `exports`.
 */
function crossedBoundary(
  fromDirectory: string,
  target: string,
): string | undefined {
  let outermost: string | undefined;
  let directory = dirname(target);

  for (;;) {
    if (
      barrelOf(directory) &&
      directory !== fromDirectory &&
      !isInside(fromDirectory, directory)
    ) {
      outermost = directory;
    }

    const parent = dirname(directory);
    const atPackageRoot = kindOf(resolve(directory, 'package.json')) === 'file';

    if (parent === directory || atPackageRoot) {
      return outermost;
    }

    directory = parent;
  }
}

/**
 * Формы `export … from '<путь>'` — всё, что создаёт поверхность бареля.
 *
 * Обычный импорт внутри бареля наружу ничего не отдаёт, поэтому в выражение
 * не входит.
 */
const REEXPORT =
  /\bexport\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|{[^}]*})\s*from\s*["']([^"']+)["']/g;

/**
 * Цель достижима из бареля по цепочке реэкспортов.
 *
 * Разбор текстовый: правило видит лишь один файл, а поднимать парсер на
 * каждый баррель дорого. На реэкспортах, где синтаксис фиксирован,
 * регулярного выражения достаточно.
 */
function reexports(
  barrel: string,
  target: string,
  depth = REEXPORT_DEPTH,
  seen = new Set<string>(),
): boolean {
  if (barrel === target) {
    return true;
  }

  if (depth === 0 || seen.has(barrel)) {
    return false;
  }
  seen.add(barrel);

  const directory = dirname(barrel);

  for (const match of readSource(barrel).matchAll(REEXPORT)) {
    const specifier = match[1];
    if (!isRelative(specifier)) {
      continue;
    }

    const resolved = resolveTarget(directory, specifier);
    const next =
      resolved === 'directory'
        ? barrelOf(resolve(directory, specifier))
        : resolved?.file;

    if (next && reexports(next, target, depth - 1, seen)) {
      return true;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Глобы опций
// ---------------------------------------------------------------------------

/**
 * Глоб в регулярное выражение: `**` через любые папки, `*` внутри одной.
 *
 * Своя реализация, а не зависимость: плагин ставится в devDependencies
 * потребителя, и лишний пакет в его дереве — плата, которой можно избежать.
 */
const SPECIAL = new Set('.+^${}()|[]\\');

function globToRegExp(pattern: string): RegExp {
  let source = '';
  let index = 0;

  while (index < pattern.length) {
    const character = pattern[index];

    if (character === '*' && pattern[index + 1] === '*') {
      // `**/` съедает и ноль папок: `**/src/x.ts` матчит `src/x.ts`
      if (pattern[index + 2] === '/') {
        source += '(?:.*/)?';
        index += 3;
      } else {
        source += '.*';
        index += 2;
      }
      continue;
    }

    if (character === '*') {
      source += '[^/]*';
    } else if (character === '?') {
      source += '[^/]';
    } else {
      source += SPECIAL.has(character) ? `\\${character}` : character;
    }

    index += 1;
  }

  return new RegExp(`^${source}$`);
}

const globCache = new Map<string, RegExp>();

function matchesAny(path: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    let regexp = globCache.get(pattern);
    if (!regexp) {
      regexp = globToRegExp(pattern);
      globCache.set(pattern, regexp);
    }

    return regexp.test(path);
  });
}

/** Путь для матчинга: от корня прогона, прямыми слэшами */
function forMatching(path: string, cwd: string): string {
  const relativePath = relative(cwd, path);
  const outside = isAbsolute(relativePath) || relativePath.startsWith('..');

  return (outside ? path : relativePath).replaceAll(sep, '/');
}

// ---------------------------------------------------------------------------
// Правило
// ---------------------------------------------------------------------------

/**
 * Узел с `source`: три декларации импорта и реэкспорта разом.
 *
 * `importKind`/`exportKind` ставит парсер TypeScript — в типах `estree` их
 * нет, а зависеть от `@typescript-eslint` правилу незачем.
 */
interface SourcedNode {
  source?: { value?: unknown } | null;
  importKind?: string;
  exportKind?: string;
}

export const importThroughBarrel: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'import reaches inside a module (a directory with a barrel file) bypassing its barrel',
    },
    schema: [
      {
        type: 'object',
        properties: {
          allowTypeImports: { type: 'boolean' },
          entrypoints: { type: 'array', items: { type: 'string' } },
          allow: { type: 'array', items: { type: 'string' } },
          onMissingReexport: { enum: ['report', 'allow'] },
          checkDynamicImports: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      crossesBoundary:
        "Import reaches inside module '{{module}}' bypassing its barrel. " +
        "Import from '{{barrel}}' instead — a directory with an index file " +
        'exposes only what its barrel re-exports.',
      privateModule:
        "'{{target}}' is not re-exported from the barrel of module " +
        "'{{module}}', so it is private to that module. Re-export it from " +
        "'{{barrel}}', or allow this import explicitly.",
    },
  },

  create(context) {
    const options: Options = { ...DEFAULTS, ...context.options[0] };
    const { filename, cwd } = context;

    // Барель собирает поверхность из внутренностей — это его работа
    if (isBarrelFile(filename)) {
      return {};
    }

    if (matchesAny(forMatching(filename, cwd), options.entrypoints)) {
      return {};
    }

    const fromDirectory = dirname(filename);

    const check = (node: Node, specifier: string, typeOnly: boolean): void => {
      if (!isRelative(specifier)) {
        return;
      }

      if (typeOnly && options.allowTypeImports) {
        return;
      }

      const resolved = resolveTarget(fromDirectory, specifier);

      // Импорт папки — обращение к её баррелю; нерезолвимое молчит
      if (resolved === undefined || resolved === 'directory') {
        return;
      }

      const { file } = resolved;

      // На баррель указали напрямую: `../providers/index.js` — та же дверь
      if (isBarrelFile(file)) {
        return;
      }

      if (matchesAny(forMatching(file, cwd), options.allow)) {
        return;
      }

      const crossed = crossedBoundary(fromDirectory, file);
      if (!crossed) {
        return;
      }

      const barrel = barrelOf(crossed);
      if (!barrel) {
        return;
      }

      const data = {
        module: forMatching(crossed, cwd),
        barrel: forMatching(barrel, cwd),
        target: forMatching(file, cwd),
      };

      if (reexports(barrel, file)) {
        context.report({ node, messageId: 'crossesBoundary', data });

        return;
      }

      if (options.onMissingReexport === 'report') {
        context.report({ node, messageId: 'privateModule', data });
      }
    };

    const checkDeclaration = (node: Node & SourcedNode): void => {
      const value = node.source?.value;
      if (typeof value !== 'string') {
        return;
      }

      const typeOnly = node.importKind === 'type' || node.exportKind === 'type';

      check(node.source as unknown as Node, value, typeOnly);
    };

    return {
      ImportDeclaration: checkDeclaration,
      ExportNamedDeclaration: checkDeclaration,
      ExportAllDeclaration: checkDeclaration,

      ImportExpression(node) {
        if (!options.checkDynamicImports) {
          return;
        }

        // Вычисляемый путь непрозрачен — единственная дыра, и она осознанная
        if (node.source.type !== 'Literal') {
          return;
        }

        const { value } = node.source;
        if (typeof value === 'string') {
          check(node.source, value, false);
        }
      },
    };
  },
};
