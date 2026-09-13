/**
 * Инструменты агента фичи пользователей.
 *
 * Отдельного списка состава у транспорта MCP нет: инструмент попадает в
 * приложение так же, как любой endpoint, — через `endpoints:` фичи.
 */

export { CreateUserTool } from './create-user.tool.js';
export { GetUserTool } from './get-user.tool.js';
export { SearchUsersTool } from './search-users.tool.js';
