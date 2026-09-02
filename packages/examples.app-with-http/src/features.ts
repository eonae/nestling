/**
 * Фичи приложения — те единицы, что перечисляет `features:` корня.
 *
 * Каждая объявлена рядом со своим кодом; здесь только сборка списка.
 * Поля `dependsOn` у фичи нет: связь `users → quotas` выводится из
 * объявленных операций, а не дублируется полем.
 */

export { OpsFeature } from './modules/ops/ops.feature';
export { QuotasFeature } from './modules/quotas/quotas.feature';
export { UsersFeature } from './users.feature';
