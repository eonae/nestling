#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { visualize } from './visualize';

const program = new Command();

program
  .name('nestling-viz')
  .description('Interactive 3D visualization of Nestling DI container')
  .version('0.1.0')
  .option('-p, --port <number>', 'Server port', '3333')
  .argument('<file>', 'Path to dependency graph JSON file')
  .option('-s, --silent', 'Suppress console output', false)
  .option('--no-open', 'Do not open browser automatically')
  .action(async (file, options) => {
    const { port, silent, open } = options;

    if (!silent) {
      console.log(
        chalk.blue('🚀 Starting Nestling DI container visualizer...'),
      );
    }

    try {
      await visualize({
        port: parseInt(port, 10),
        graphFile: file,
        silent,
        openBrowser: open,
      });

      if (!silent) {
        console.log(
          chalk.green(
            `✨ Visualization server running at http://localhost:${port}`,
          ),
        );
        if (open) {
          console.log(chalk.green('🌐 Browser window opened automatically'));
        }
      }
    } catch (error) {
      if (!silent) {
        console.error(chalk.red('❌ Visualization failed:'), error);
      }
      process.exit(1);
    }
  });

program.parse();
