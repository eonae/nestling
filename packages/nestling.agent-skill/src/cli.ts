#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Команда установки скилла: `npx @nestlingjs/agent-skill`.
 *
 * Разбирает `--dir` и `--force`, печатает итог тремя числами и называет
 * расходящиеся файлы. Расхождение без `--force` — код выхода 1: правки
 * пользователя молча не теряются.
 */
import { installSkill } from './index.js';

const USAGE = 'Usage: npx @nestlingjs/agent-skill [--dir <path>] [--force]';

const args = process.argv.slice(2);

let dir: string | undefined;
let force = false;

for (let index = 0; index < args.length; index++) {
  const arg = args[index];

  if (arg === '--force') {
    force = true;
  } else if (arg === '--dir') {
    dir = args[++index];

    if (dir === undefined) {
      console.error(`--dir needs a path.\n${USAGE}`);
      process.exit(1);
    }
  } else {
    console.error(`Unknown argument: ${arg}.\n${USAGE}`);
    process.exit(1);
  }
}

const report = await installSkill({ dir, force });

console.log(`Nestling skill → ${report.dir}`);
console.log(
  `created ${report.created.length}, ` +
    `unchanged ${report.unchanged.length}, ` +
    `diverged ${report.diverged.length}`,
);

if (report.diverged.length > 0) {
  const what = report.forced ? 'overwritten' : 'left as is';

  console.log(`Diverged from the packaged skill (${what}):`);

  for (const name of report.diverged) {
    console.log(`  ${name}`);
  }

  if (!report.forced) {
    console.log('Run with --force to replace them.');
    process.exit(1);
  }
}
