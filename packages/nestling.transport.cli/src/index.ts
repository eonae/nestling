/**
 * `@nestlingjs/transport.cli`: командная строка как inbound-транспорт.
 *
 * Барель перечисляет имена поимённо, а не через `export *`. Имя, которого
 * здесь нет, остаётся внутренним: его можно менять, не ломая тех, кто
 * установил пакет.
 *
 * План вопросов публичен намеренно: политика `missing: 'prompt'` выводит
 * форму вопроса из JSON Schema, и это единственный способ проверить план
 * командой без терминала.
 *
 * Полный перечень — в README пакета.
 */

// ./transport.js — 7
export { cli, CLI_CAPABILITIES, CliTransport, parseArgv } from './transport.js';
export type {
  CliInput,
  CliInputStream,
  CliTransportOptions,
} from './transport.js';

// ./cli-endpoint.js — 5
export { cliBindingOf, cliEndpoint } from './cli-endpoint.js';
export type {
  CliBinding,
  CliEndpointDictionary,
  CliMissingPolicy,
} from './cli-endpoint.js';

// ./prompt.js — 4
export { buildPromptPlan } from './prompt.js';
export type { PromptKind, PromptPlan, PromptQuestion } from './prompt.js';

// ./token.js — 2
export { CLI_TRANSPORT_NAME, CliTransport$ } from './token.js';
