/**
 * Сверка типов пакета с типами протокола.
 *
 * Файл не гоняется vitest'ом: он и есть тест. Объявленные пакетом
 * `McpToolDefinition` и `McpCallToolResult` присваиваются `Tool` и
 * `CallToolResult` из `@modelcontextprotocol/sdk/types.js`, и расхождение
 * роняет `tsc` на сборке пакета.
 *
 * SDK стоит в `devDependencies` и импортируется отсюда и из спеков. Файл
 * исключён из `tsconfig.build.json`, поэтому в `dist` он не попадает.
 * Список поддерживаемых версий сверяется со списком SDK в `protocol.spec.ts`:
 * SDK объявляет его как `string[]`, и типом эту сверку не выразить.
 */

/* eslint-disable @typescript-eslint/no-unused-vars */

import type { McpCallToolResult, McpToolDefinition } from './types.js';

import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';

declare const ourTool: McpToolDefinition;
declare const ourResult: McpCallToolResult;

/** Определение инструмента пакета — определение инструмента протокола */
const asSdkTool: Tool = ourTool;

/** Результат вызова пакета — результат вызова протокола */
const asSdkResult: CallToolResult = ourResult;
