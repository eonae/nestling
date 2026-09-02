/**
 * `testUnit` — одна фича или один плагин в изоляции.
 */

import type { TestApp, TestStub } from './app.js';
import { assembleTest } from './app.js';
import type { TestConfig } from './config.js';

import type { Bundle } from '@nestling/app';
import type { TransportDeclaration } from '@nestling/transport';

/** Словарь `testUnit` */
export interface TestUnitOptions {
  /**
   * Поставка недостающего: пары `токен → значение` и стабы операций.
   *
   * Для модуля в изоляции это не подмена, а именно поставка — сосед, чьи
   * провайдеры сюда не попали. Меж-фичевый вызов, объявленный модулем,
   * поставляется тем же полем: `stub(Operation, impl)` возвращает пару
   * `токен вызывателя → фейк`.
   */
  stubs?: readonly TestStub[];

  /** Конфиг: источник, одна привязка или их список */
  config?: TestConfig;

  /** Транспорты для endpoint'ов единицы — объявляются явно, как и в бою */
  transports?: readonly TransportDeclaration[];
}

/**
 * Поднимает мини-приложение вокруг одной фичи или одного плагина.
 *
 * Регистрируются: сама единица (с её модулями и их `dependsOn`),
 * kernel-модуль конфига (его корень регистрирует всегда) и перечисленные
 * стабы. Дальше — те же фазы 0–3 и тот же {@link TestApp}, что у
 * `assembleTest`.
 *
 * Живёт внутри пакета единицы, поэтому её внутренние токены видны тесту
 * без добавления в публичный экспорт.
 *
 * Недостающие зависимости обязаны быть застабаны явно: сборка падает
 * ошибкой, перечисляющей **все** недостающие токены с потребителем
 * каждого, а не первый попавшийся.
 *
 * @param unit - Фича или плагин под тестом
 * @param options - Стабы, конфиг и транспорты
 * @returns Приложение с `call`/`get`/`close`
 *
 * @example
 * ```typescript
 * await using app = await testUnit(UsersFeature, {
 *   stubs: [[ILogger, noopLogger], stub(ChargeCard, async () => ({ id: 'c1' }))],
 *   transports: [http()],
 * });
 * ```
 */
export async function testUnit(
  unit: Bundle,
  options: TestUnitOptions = {},
): Promise<TestApp> {
  return await assembleTest({
    ...(unit.role === 'plugin' ? { plugins: [unit] } : { features: [unit] }),
    stubs: options.stubs,
    config: options.config,
    transports: options.transports,
  });
}
