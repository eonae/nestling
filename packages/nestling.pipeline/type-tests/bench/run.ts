/**
 * Прогон бюджета типового механизма pipeline.
 *
 * Два измерения с разной строгостью (design D8):
 *
 * - `Instantiations` / `Types` — детерминированные счётчики компилятора,
 *   меряются **дельтой к базе** (пустой файл при том же tsconfig), потому
 *   что абсолютные значения зависят от версии TypeScript и `lib.d.ts`.
 *   Порог жёсткий: превышение валит прогон.
 * - латентность `tsserver` (hover, автокомплит) — щедрый потолок, ловящий
 *   регрессию на порядок, а не дрожание машины.
 *
 * Пороги и история замеров живут в `type-tests/BUDGET.md` — раннер читает
 * их оттуда, поэтому подвинуть порог, не оставив записи, нельзя.
 *
 * Запуск:
 *   yarn workspace @nestling/pipeline type-budget
 *   yarn workspace @nestling/pipeline type-budget --report       # без падения
 *   yarn workspace @nestling/pipeline type-budget --layers=20    # другой размер
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import ts from 'typescript';

import { createProgram, typeTestsDir } from '../support/compile.js';
import { BASE_SOURCE, generateGraph } from './generate.js';
import { measureLatency } from './tsserver.js';

interface Budget {
  layers: number;
  endpoints: number;
  instantiationsDelta: number;
  typesDelta: number;
  quickinfoMs: number;
  completionMs: number;
}

const budgetFile = resolve(typeTestsDir, 'BUDGET.md');
const generatedDir = resolve(typeTestsDir, '.generated');

/**
 * Пороги берутся из машиночитаемого блока `BUDGET.md`: файл с порогом
 * и файл с обоснованием — намеренно один и тот же.
 */
function readBudget(): Budget {
  const text = readFileSync(budgetFile, 'utf8');
  const match = /```json\n([\S\s]*?)\n```/.exec(text);
  if (!match) {
    throw new Error(`${budgetFile}: не найден json-блок с порогами`);
  }
  return JSON.parse(match[1]) as Budget;
}

interface Counters {
  instantiations: number;
  types: number;
  diagnostics: ts.Diagnostic[];
}

function measure(configPath: string, file: string): Counters {
  const program = createProgram(configPath, [file]);
  // Счётчики набираются в ходе проверки типов — сначала диагностики.
  const diagnostics = [...ts.getPreEmitDiagnostics(program)];

  return {
    instantiations: program.getInstantiationCount(),
    types: program.getTypeCount(),
    diagnostics,
  };
}

function prepare(budget: Budget): {
  configPath: string;
  graphFile: string;
  baseFile: string;
  probes: ReturnType<typeof generateGraph>;
} {
  rmSync(generatedDir, { recursive: true, force: true });
  mkdirSync(generatedDir, { recursive: true });

  const graph = generateGraph({
    layers: budget.layers,
    endpoints: budget.endpoints,
  });

  const graphFile = resolve(generatedDir, 'graph.ts');
  const baseFile = resolve(generatedDir, 'base.ts');
  const configPath = resolve(generatedDir, 'tsconfig.json');

  writeFileSync(graphFile, graph.source);
  writeFileSync(baseFile, BASE_SOURCE);
  writeFileSync(
    configPath,
    `${JSON.stringify({ extends: '../tsconfig.json', include: ['*.ts'] }, null, 2)}\n`,
  );

  return { configPath, graphFile, baseFile, probes: graph };
}

function formatNumber(value: number): string {
  return value.toLocaleString('en-US').replace(/,/g, ' ');
}

async function main(): Promise<void> {
  const reportOnly = process.argv.includes('--report');
  const budget = readBudget();

  // Размер графа переопределяется с командной строки — этим снимаются
  // строки истории замеров в BUDGET.md, не трогая пороги.
  for (const key of ['layers', 'endpoints'] as const) {
    const arg = process.argv.find((a) => a.startsWith(`--${key}=`));
    if (arg) {
      budget[key] = Number(arg.split('=')[1]);
    }
  }

  const { configPath, graphFile, baseFile, probes } = prepare(budget);

  const started = performance.now();
  const base = measure(configPath, baseFile);
  const baseMs = performance.now() - started;

  const graphStarted = performance.now();
  const graph = measure(configPath, graphFile);
  const graphMs = performance.now() - graphStarted;

  const failures: string[] = [];

  const deepDiagnostics = graph.diagnostics.filter(
    // TS2589: Type instantiation is excessively deep and possibly infinite
    (d) => d.code === 2589,
  );
  const otherDiagnostics = graph.diagnostics.filter((d) => d.code !== 2589);

  const instantiationsDelta = graph.instantiations - base.instantiations;
  const typesDelta = graph.types - base.types;

  const latency = await measureLatency(graphFile, probes);

  console.log(
    [
      '',
      `Бюджет типов @nestling/pipeline — TypeScript ${ts.version}`,
      `Граф: ${budget.layers} слоёв вложенной композицией, ${budget.endpoints} эндпоинтов`,
      '',
      `  Instantiations  база ${formatNumber(base.instantiations)}  граф ${formatNumber(graph.instantiations)}  Δ ${formatNumber(instantiationsDelta)}  (порог ${formatNumber(budget.instantiationsDelta)})`,
      `  Types           база ${formatNumber(base.types)}  граф ${formatNumber(graph.types)}  Δ ${formatNumber(typesDelta)}  (порог ${formatNumber(budget.typesDelta)})`,
      `  Check time      база ${(baseMs / 1000).toFixed(2)} s  граф ${(graphMs / 1000).toFixed(2)} s`,
      '',
      `  tsserver hover        ${latency.quickinfoMs.toFixed(0)} ms  (потолок ${budget.quickinfoMs} ms)`,
      `  tsserver completion   ${latency.completionMs.toFixed(0)} ms  (потолок ${budget.completionMs} ms)`,
      `  tsserver прогрев      ${latency.warmupMs.toFixed(0)} ms  (загрузка проекта, справочно)`,
      '',
    ].join('\n'),
  );

  if (deepDiagnostics.length > 0) {
    failures.push(
      `граф из ${budget.layers} слоёв не компилируется: ${deepDiagnostics.length}× TS2589 ` +
        '(type instantiation is excessively deep and possibly infinite)',
    );
  }

  if (otherDiagnostics.length > 0) {
    failures.push(
      `синтетический граф обязан компилироваться чисто, а дал ${otherDiagnostics.length} диагностик:\n` +
        otherDiagnostics
          .slice(0, 5)
          .map(
            (d) =>
              `    TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ').slice(0, 200)}`,
          )
          .join('\n'),
    );
  }

  if (instantiationsDelta > budget.instantiationsDelta) {
    failures.push(
      `Instantiations Δ ${formatNumber(instantiationsDelta)} > порога ${formatNumber(budget.instantiationsDelta)}`,
    );
  }

  if (typesDelta > budget.typesDelta) {
    failures.push(
      `Types Δ ${formatNumber(typesDelta)} > порога ${formatNumber(budget.typesDelta)}`,
    );
  }

  if (latency.quickinfoMs > budget.quickinfoMs) {
    failures.push(
      `латентность hover ${latency.quickinfoMs.toFixed(0)} ms > потолка ${budget.quickinfoMs} ms`,
    );
  }

  if (latency.completionMs > budget.completionMs) {
    failures.push(
      `латентность автокомплита ${latency.completionMs.toFixed(0)} ms > потолка ${budget.completionMs} ms`,
    );
  }

  if (failures.length === 0) {
    console.log('Бюджет соблюдён.\n');
    return;
  }

  console.error(`Бюджет нарушен:\n${failures.map((f) => `  - ${f}`).join('\n')}\n`);
  console.error(
    'Порог двигается только вместе с новой записью замера в type-tests/BUDGET.md.\n',
  );

  if (!reportOnly) {
    process.exitCode = 1;
  }
}

await main();
