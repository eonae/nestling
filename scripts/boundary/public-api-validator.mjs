/**
 * Публичный API фреймворка не называет валидатора — проверка механическая.
 *
 * Граница проходит по **экспортам барреля**, а не по составу зависимостей:
 * пакет, который пишет свои схемы на zod, зависит от него как от выбора
 * реализации, и приложению эта зависимость видна только строкой в
 * `node_modules`. Нарушением считается вендор, попавший в тип, который
 * приложение видит: тогда схему на другом валидаторе оно уже не напишет.
 *
 * Проверяются собранные объявления: для каждого публикуемого пакета
 * берётся `dist/index.d.ts`, перечисляются его экспорты и читается текст
 * их объявлений вместе с выведенным типом. Комментарии под проверку не
 * попадают — они не типы.
 *
 * Программа компилятора одна на все пакеты. Каждый `dist/index.d.ts` тянет
 * за собой декларации зависимостей, а зависимости у пакетов общие: программа
 * на пакет означала бы, что один и тот же `lib.d.ts` читается двадцать раз.
 *
 * Исключение ровно одно и названо именем пакета: `@nestlingjs/schema.zod`
 * называет zod в типах своих опций, потому что это пакет вендора.
 *
 * Прогон: `node scripts/boundary/public-api-validator.mjs` (входит в
 * `yarn verify`).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import ts from 'typescript';

import { publishablePackages } from '../packages.mjs';

/** Пакет вендора: называть свой валидатор — его работа */
const EXEMPT = new Set(['@nestlingjs/schema.zod']);

/** Валидаторы, которых не должно быть в публичных типах */
const VALIDATORS = [
  'zod',
  'valibot',
  'arktype',
  'typebox',
  'yup',
  'joi',
];

const pattern = new RegExp(`\\b(${VALIDATORS.join('|')})\\b`, 'i');

/** Экспорты барреля: имя, текст объявления и выведенный тип */
function publicSurface(program, checker, entry) {
  const source = program.getSourceFile(entry);
  const moduleSymbol = source && checker.getSymbolAtLocation(source);

  if (!moduleSymbol) {
    return [];
  }

  return checker.getExportsOfModule(moduleSymbol).map((symbol) => {
    const declarations = symbol.getDeclarations() ?? [];
    const texts = declarations.map((declaration) => declaration.getText());

    const valueDeclaration = symbol.valueDeclaration ?? declarations[0];
    if (valueDeclaration) {
      texts.push(
        checker.typeToString(
          checker.getTypeOfSymbolAtLocation(symbol, valueDeclaration),
          undefined,
          ts.TypeFormatFlags.NoTruncation |
            ts.TypeFormatFlags.UseFullyQualifiedType,
        ),
      );
    }

    return { name: symbol.getName(), text: texts.join('\n') };
  });
}

/** Публикуемые пакеты, чья сборка на месте */
const targets = publishablePackages()
  .map(({ name, dir }) => ({ name, entry: join(dir, 'dist', 'index.d.ts') }))
  .filter(({ name, entry }) => !EXEMPT.has(name) && existsSync(entry));

const program = ts.createProgram(
  targets.map(({ entry }) => entry),
  {
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  },
);

const checker = program.getTypeChecker();
const violations = [];

for (const { name, entry } of targets) {
  for (const exported of publicSurface(program, checker, entry)) {
    const found = pattern.exec(exported.text);

    if (found) {
      violations.push({ package: name, export: exported.name, vendor: found[1] });
    }
  }
}

if (violations.length > 0) {
  console.error(
    `[public-api] ${violations.length} public export(s) name a validator:\n`,
  );
  for (const one of violations) {
    console.error(`  ${one.package}: ${one.export} names '${one.vendor}'`);
  }
  console.error(
    `\nA schema written by the framework may be a vendor value, but the type ` +
      `it is declared with must stay neutral: annotate it with ` +
      `StandardSchemaV1<unknown, T>. The application chooses its own ` +
      `validator, and a vendor in a public type takes that choice away.`,
  );
  process.exit(1);
}

console.log(`[public-api] ${targets.length} package(s) name no validator: ok`);
