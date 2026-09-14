/**
 * Сборка пакета: JavaScript выпускает swc, декларации — пофайловый эмиттер
 * TypeScript. Проверки типов здесь нет.
 *
 * Раньше сборку вёл `tsc -p tsconfig.build.json`, и 92% её времени уходило
 * на проверку типов — третий проход по тому же коду после `typecheck` и
 * программы линтера. Под `isolatedDeclarations` декларация выводится из
 * одного файла, поэтому программа компилятора сборке больше не нужна:
 * `ts.transpileDeclaration` читает файл и пишет `.d.ts`, ничего не резолвя.
 *
 * Ошибку типов находит задача `typecheck`. Если исходник не выражает свою
 * декларацию, сборка падает на нём же: пофайловый эмиттер отдаёт те самые
 * диагностики `TS90xx`.
 *
 * Состав входа берётся из `tsconfig.build.json` пакета — того же файла, что
 * и раньше. Второго списка исключений нет, и разъехаться нечему.
 *
 * Прогон: `node ../../scripts/build-package.mjs` из каталога пакета.
 */
import { transform } from '@swc/core';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import process from 'node:process';

import ts from 'typescript';

/** Семантика, общая со сборкой тестов (см. `vitest.config.base.js`) */
const SWC_OPTIONS = {
  jsc: {
    target: 'es2022',
    parser: { syntax: 'typescript', decorators: true },
    transform: {
      decoratorVersion: '2022-03',
      useDefineForClassFields: true,
    },
    keepClassNames: true,
  },
  module: { type: 'es6' },
  sourceMaps: false,
  isModule: true,
};

/** Разбирает `tsconfig.build.json` пакета: список файлов и куда эмитить */
function readProject(cwd) {
  const path = join(cwd, 'tsconfig.build.json');
  const { config, error } = ts.readConfigFile(path, ts.sys.readFile);

  if (error) {
    throw new Error(ts.flattenDiagnosticMessageText(error.messageText, '\n'));
  }

  const parsed = ts.parseJsonConfigFileContent(config, ts.sys, cwd);

  if (parsed.errors.length > 0) {
    const text = parsed.errors
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
      .join('\n');
    throw new Error(text);
  }

  const { rootDir, outDir } = parsed.options;

  if (!rootDir || !outDir) {
    throw new Error(
      `${path}: сборке нужны 'rootDir' и 'outDir' — без них не собрать пути в 'dist'.`,
    );
  }

  return { files: parsed.fileNames, options: parsed.options, rootDir, outDir };
}

/** Один файл: `.js` от swc и `.d.ts` от пофайлового эмиттера */
async function emit(file, { options, rootDir, outDir }) {
  const source = await readFile(file, 'utf8');
  const stem = relative(rootDir, file).replace(/\.ts$/, '');
  const target = join(outDir, stem);

  await mkdir(dirname(target), { recursive: true });

  const { code } = await transform(source, { ...SWC_OPTIONS, filename: file });
  const declaration = ts.transpileDeclaration(source, {
    fileName: file,
    compilerOptions: options,
    reportDiagnostics: true,
  });

  if (declaration.diagnostics && declaration.diagnostics.length > 0) {
    return declaration.diagnostics;
  }

  await Promise.all([
    writeFile(`${target}.js`, code),
    writeFile(`${target}.d.ts`, declaration.outputText),
  ]);

  return [];
}

const cwd = resolve(process.cwd());
const project = readProject(cwd);

await rm(project.outDir, { recursive: true, force: true });

const results = await Promise.all(
  project.files.map((file) => emit(file, project)),
);
const diagnostics = results.flat();

if (diagnostics.length > 0) {
  for (const d of diagnostics) {
    const where = d.file
      ? `${relative(cwd, d.file.fileName)}(${
          d.file.getLineAndCharacterOfPosition(d.start ?? 0).line + 1
        })`
      : '';
    console.error(
      `${where}: error TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`,
    );
  }

  console.error(
    `\nThe declaration of a source file must be written, not inferred: ` +
      `a package builds its declarations one file at a time, without a ` +
      `program. Annotate the exports named above.`,
  );
  process.exit(1);
}

console.log(`[build] ${project.files.length} file(s) -> ${relative(cwd, project.outDir)}`);
