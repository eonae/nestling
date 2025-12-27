import { build } from 'esbuild';

const config = {
  entryPoints: ['src/cli.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node24',
  outfile: 'dist/cli.js',
  sourcemap: true,
  external: ['commander'],
};

build(config).catch(() => process.exit(1));
