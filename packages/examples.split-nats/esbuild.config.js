/* eslint-disable no-undef */
/* eslint-disable unicorn/no-process-exit */

import { build } from 'esbuild';

const config = {
  entryPoints: ['src/main.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node24',
  outfile: 'dist/bundle.js',
  sourcemap: true,
};

build(config).catch(() => process.exit(1));
