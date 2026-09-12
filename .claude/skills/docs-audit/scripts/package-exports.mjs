/**
 * Публичные имена пакета: что видит тот, кто его установил.
 *
 * Источник — барели, названные в поле `exports` файла `package.json`, и
 * только исходники: `./dist/index.js` читается как `src/index.ts`. Так
 * проверка работает на чистом клоне, до `yarn build`. Разбор идёт через
 * TypeScript compiler API без тайпчекера: нужен список имён, а не их типы.
 *
 * Имя, пришедшее из соседнего пакета (`export * from '@nestlingjs/operations'`),
 * попадает не в `names`, а в `reexports`: в README такой пакет занимает одну
 * строку со ссылкой, а не повторяет чужой перечень.
 *
 * Самопроверка на трёх пакетах с подпутями:
 *   node .claude/skills/docs-audit/scripts/package-exports.mjs --self-test
 * Перечень имён одного пакета:
 *   node .claude/skills/docs-audit/scripts/package-exports.mjs packages/nestling.app
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';

import ts from 'typescript';

/** `./dist/testing/index.js` и `./dist/tokens.d.ts` ведут в один и тот же `src`. */
function distToSrc(pkgDir, target) {
  const rel = target.replace(/^\.\//, '').replace(/^dist\//, '');
  const base = rel.replace(/\.d\.ts$|\.js$/, '');
  for (const candidate of [`${base}.ts`, `${base}/index.ts`, `${base}.tsx`]) {
    const file = join(pkgDir, 'src', candidate);
    if (existsSync(file)) return file;
  }
  return null;
}

/** У условного экспорта нужен любой лист: условия ведут в один файл. */
function firstTarget(entry) {
  if (typeof entry === 'string') return entry;
  if (!entry || typeof entry !== 'object') return null;
  for (const key of ['import', 'types', 'default', 'node', 'testing']) {
    if (key in entry) {
      const found = firstTarget(entry[key]);
      if (found) return found;
    }
  }
  for (const value of Object.values(entry)) {
    const found = firstTarget(value);
    if (found) return found;
  }
  return null;
}

function resolveRelative(fromFile, spec) {
  const base = resolve(dirname(fromFile), spec).replace(/\.js$/, '');
  for (const candidate of [`${base}.ts`, `${base}/index.ts`, `${base}.tsx`, `${base}.d.ts`]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const isRelative = (spec) => spec.startsWith('.');

function declaredNames(node, out) {
  if (ts.isVariableStatement(node)) {
    for (const d of node.declarationList.declarations) {
      if (ts.isIdentifier(d.name)) out.add(d.name.text);
    }
    return;
  }
  if (node.name && ts.isIdentifier(node.name)) out.add(node.name.text);
}

const hasExportModifier = (node) =>
  node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;

/**
 * Имена одного барреля вместе с раскрытыми `export *`.
 *
 * Сами операторы `export *` барреля попадают в `stars` специфаерами: спека
 * `packages-layout` их запрещает, а раскрытие имён их не сохраняет. Звёздочки
 * внутренних модулей туда не идут — правило про барель, а не про его нутро.
 *
 * @returns {{ names: Set<string>, reexports: Set<string>, missing: string[],
 *             stars: string[] }}
 */
function collectBarrel(file, seen = new Set(), acc = null) {
  const state = acc ?? { names: new Set(), reexports: new Set(), missing: [], stars: [] };
  const isBarrel = acc === null;
  if (seen.has(file)) return state;
  seen.add(file);

  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.ESNext,
    false,
    ts.ScriptKind.TS,
  );

  for (const node of source.statements) {
    if (ts.isExportDeclaration(node)) {
      const spec = node.moduleSpecifier?.text;
      const clause = node.exportClause;
      if (!clause) {
        // export * from '...'
        if (!spec) continue;
        if (isBarrel) state.stars.push(spec);
        if (isRelative(spec)) {
          const next = resolveRelative(file, spec);
          if (next) collectBarrel(next, seen, state);
          else state.missing.push(`${relative(process.cwd(), file)}: ${spec}`);
        } else {
          state.reexports.add(spec);
        }
        continue;
      }
      if (ts.isNamespaceExport(clause)) {
        state.names.add(clause.name.text);
        continue;
      }
      for (const element of clause.elements) {
        if (spec && !isRelative(spec)) state.reexports.add(spec);
        else state.names.add(element.name.text);
      }
      continue;
    }
    if (ts.isExportAssignment(node)) continue; // export default — имени нет
    if (hasExportModifier(node)) declaredNames(node, state.names);
  }

  return state;
}

/**
 * Публичные имена пакета по подпутям поля `exports`.
 *
 * @param {string} pkgDir каталог пакета
 * @returns {{
 *   name: string,
 *   bin: string[],
 *   subpaths: Array<{ key: string, barrel: string | null, names: Set<string>,
 *                     reexports: Set<string>, missing: string[], stars: string[] }>,
 * }}
 */
export function collectPackageExports(pkgDir) {
  const manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
  const bin =
    typeof manifest.bin === 'string'
      ? [manifest.name]
      : Object.keys(manifest.bin ?? {});
  const subpaths = [];

  for (const [key, entry] of Object.entries(manifest.exports ?? {})) {
    const target = firstTarget(entry);
    const barrel = target ? distToSrc(pkgDir, target) : null;
    if (!barrel) {
      subpaths.push({
        key,
        barrel: null,
        names: new Set(),
        reexports: new Set(),
        missing: [],
        stars: [],
      });
      continue;
    }
    subpaths.push({ key, barrel, ...collectBarrel(barrel) });
  }

  return { name: manifest.name, bin, subpaths };
}

/** Все публичные имена пакета одним множеством. */
export function allNames(pkg) {
  const names = new Set();
  for (const s of pkg.subpaths) for (const n of s.names) names.add(n);
  return names;
}

/** Соседние пакеты, чьи имена реэкспортированы. */
export function allReexports(pkg) {
  const specs = new Set();
  for (const s of pkg.subpaths) for (const r of s.reexports) specs.add(r);
  return specs;
}

// ── Запуск из командной строки ───────────────────────────────────────────────

/**
 * Барель с `export *` на временном пакете: в репозитории такого барреля нет,
 * и случай пришлось бы выдумывать заново при каждой правке скрипта.
 *
 * @returns {string[]} описания расхождений, пустой массив — случай пройден
 */
function starCaseFailures() {
  const dir = mkdtempSync(join(tmpdir(), 'package-exports-'));
  try {
    mkdirSync(join(dir, 'src'));
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'star-fixture', exports: { '.': './dist/index.js' } }),
    );
    writeFileSync(
      join(dir, 'src', 'index.ts'),
      "export * from './inner.js';\nexport { named } from './inner.js';\n",
    );
    writeFileSync(join(dir, 'src', 'inner.ts'), "export * from './deep.js';\nexport const named = 1;\n");
    writeFileSync(join(dir, 'src', 'deep.ts'), 'export const deep = 2;\n');

    const [root] = collectPackageExports(dir).subpaths;
    const failures = [];
    if (root.stars.join(', ') !== './inner.js') {
      failures.push(`фикстура: звёздочки барреля ${JSON.stringify(root.stars)} вместо ['./inner.js']`);
    }
    for (const expected of ['named', 'deep']) {
      if (!root.names.has(expected)) failures.push(`фикстура: нет имени ${expected}`);
    }
    return failures;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}



const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);

if (invokedDirectly) {
  const root = process.cwd();
  const arg = process.argv[2];

  if (arg === '--self-test') {
    // Три пакета с подпутями: раскрытие `export *`, второй вход, реэкспорт соседа.
    const cases = [
      { dir: 'packages/nestling.app', subpath: './testing', expect: ['makeApp', 'wireApp'] },
      { dir: 'packages/nestling.container', subpath: './tokens', expect: ['makeToken', 'Token'] },
      { dir: 'packages/nestling.transport.nats', subpath: './testing', expect: ['nats', 'natsDouble'] },
    ];
    const failures = [];
    for (const f of starCaseFailures()) failures.push(f);
    for (const c of cases) {
      const pkg = collectPackageExports(join(root, c.dir));
      const keys = pkg.subpaths.map((s) => s.key);
      if (!keys.includes(c.subpath)) {
        failures.push(`${c.dir}: подпуть ${c.subpath} не разобран (есть ${keys.join(', ')})`);
      }
      for (const s of pkg.subpaths) {
        if (!s.barrel) failures.push(`${c.dir}: у подпути ${s.key} не найден барель в src`);
        if (s.missing.length) failures.push(`${c.dir}: не разрешены ${s.missing.join(', ')}`);
        if (s.barrel && s.names.size === 0 && s.reexports.size === 0) {
          failures.push(`${c.dir}: подпуть ${s.key} не дал ни одного имени`);
        }
      }
      const names = allNames(pkg);
      for (const expected of c.expect) {
        if (!names.has(expected)) failures.push(`${c.dir}: нет ожидаемого имени ${expected}`);
      }
      console.log(`${pkg.name}: ${names.size} имён, подпути ${keys.join(', ')}`);
    }
    if (failures.length) {
      for (const f of failures) console.error(`FAIL ${f}`);
      process.exit(1);
    }
    console.log('Самопроверка пройдена.');
    process.exit(0);
  }

  if (!arg) {
    console.error('Укажите каталог пакета или --self-test.');
    process.exit(2);
  }
  const pkg = collectPackageExports(resolve(root, arg));
  console.log(pkg.name, pkg.bin.length ? `(bin: ${pkg.bin.join(', ')})` : '');
  for (const s of pkg.subpaths) {
    console.log(`\n${s.key} → ${s.barrel ? relative(root, s.barrel) : 'НЕТ БАРЕЛЯ'}`);
    console.log(`  имён ${s.names.size}: ${[...s.names].sort().join(', ')}`);
    if (s.reexports.size) console.log(`  реэкспорт: ${[...s.reexports].join(', ')}`);
    if (s.stars.length) console.log(`  export *: ${s.stars.join(', ')}`);
    if (s.missing.length) console.log(`  не разрешены: ${s.missing.join(', ')}`);
  }
}
