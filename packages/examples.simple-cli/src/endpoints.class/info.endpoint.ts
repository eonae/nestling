/* eslint-disable no-console */

import type { ResponseContext } from '@nestling/pipeline';
import { Endpoint } from '@nestling/pipeline';
import { z } from 'zod';

export const InfoResponseSchema = z.object({
  platform: z.string(),
  arch: z.string(),
  nodeVersion: z.string(),
  cwd: z.string(),
  uptime: z.string(),
  memory: z.object({
    heapUsed: z.string(),
    heapTotal: z.string(),
  }),
});

export type InfoResponse = z.infer<typeof InfoResponseSchema>;

@Endpoint({
  transport: 'cli',
  pattern: 'info',
  output: InfoResponseSchema,
})
export class InfoEndpoint {
  async handle(): Promise<ResponseContext<InfoResponse>> {
    const info = {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      cwd: process.cwd(),
      uptime: `${Math.floor(process.uptime())}s`,
      memory: {
        heapUsed: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
        heapTotal: `${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)}MB`,
      },
    };

    console.log('System Information:');
    console.log(`  Platform: ${info.platform}`);
    console.log(`  Architecture: ${info.arch}`);
    console.log(`  Node Version: ${info.nodeVersion}`);
    console.log(`  Current Directory: ${info.cwd}`);
    console.log(`  Process Uptime: ${info.uptime}`);
    console.log(`  Heap Used: ${info.memory.heapUsed}`);
    console.log(`  Heap Total: ${info.memory.heapTotal}`);

    return {
      status: 0,
      value: info,
      meta: {},
    };
  }
}
