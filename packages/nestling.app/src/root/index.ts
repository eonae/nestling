export * from './app.js';
export * from './boundary.js';
// Discovery отдаётся не целиком: проход по единицам остаётся внутренним,
// потому что публичный вход в discovery один — `app.discover(args?)`.
// Только у декларации есть аргумент сборки, а без него состав документа
// расходится с составом процесса
export { Discovery$ } from './discovery.js';
export type { DiscoveredEndpoint, EndpointDiscovery } from './discovery.js';
export * from './feature.js';
export * from './phase.js';
