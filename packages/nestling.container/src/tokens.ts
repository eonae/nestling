/**
 * Точка входа subpath'а `@nestlingjs/container/tokens`: DI-токены и семейства
 * DI-токенов без остального контейнера.
 *
 * Экспортирует два модуля без runtime-импортов: `common.ts` (DI-токен и его
 * строковая форма) и `providers/token-family.ts` (семейства DI-токенов).
 * Импорт этого subpath'а не тянет ни билдер графа, ни `@nestlingjs/common.graphs`.
 *
 * Нужен пакету `@nestlingjs/operations`: операция создаёт `.caller` и
 * `.emitter` как членов семейств, а членство регистрируется только в самом
 * семействе. Импорт через основной вход пакета втянул бы весь контейнер
 * в бандл, куда импортируют операцию. Перечень подпути — подмножество
 * перечня основного входа.
 *
 * Барель перечисляет имена поимённо, а не через `export *`: подпуть — такая
 * же точка входа, и обещает он наравне с корнем.
 */

// ./common.js — 3
export { makeToken, tokenId } from './common.js';
export type { Token } from './common.js';

// ./providers/token-family.js — 2
export { makeTokenFamily } from './providers/token-family.js';
// `TokenFamily` — тип результата `makeTokenFamily`: без него объявление
// семейства у потребителя не выводится (TS2742).
export type { TokenFamily } from './providers/token-family.js';
