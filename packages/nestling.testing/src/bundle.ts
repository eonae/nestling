/**
 * `testBundle` — одна фича или один плагин в изоляции.
 */

import type { TestApp, TestStub } from './app.js';
import { buildTest } from './app.js';

import type { Binding, Bundle, TransportDeclaration } from '@nestlingjs/app';
import { makeApp } from '@nestlingjs/app';

/** Словарь `testBundle` */
export interface TestBundleOptions {
  /**
   * Поставка недостающего: пары `DI-токен → значение` и стабы операций.
   *
   * Для модуля в изоляции это не подмена, а именно поставка — сосед, чьи
   * провайдеры сюда не попали. Меж-фичевый вызов, объявленный модулем,
   * поставляется тем же полем: `stub(Operation, impl)` возвращает пару
   * `DI-токен вызывателя → фейк`.
   */
  stubs?: readonly TestStub[];

  /** Конфиг: список привязок `bind()` */
  config?: readonly Binding[];

  /**
   * Транспорты для endpoint'ов единицы — объявляются явно, как и в бою.
   *
   * Сервер приходит по ссылке `server` транспорта; порта ему не нужно:
   * тестовая сборка останавливается на WIRE и сокета не открывает.
   */
  transports?: readonly TransportDeclaration[];
}

/**
 * Поднимает мини-приложение вокруг одной фичи или одного плагина.
 *
 * Регистрируются: сама единица (с её модулями и их `dependsOn`),
 * kernel-модуль конфига (его корень регистрирует всегда) и перечисленные
 * стабы. Дальше — те же фазы 0–3 и тот же {@link TestApp}, что у
 * `buildTest`.
 *
 * Живёт внутри пакета единицы, поэтому её внутренние DI-токены видны тесту
 * без добавления в публичный экспорт.
 *
 * Недостающие зависимости обязаны быть застабаны явно: сборка падает
 * ошибкой, перечисляющей **все** недостающие DI-токены с потребителем
 * каждого, а не первый попавшийся.
 *
 * @param bundle - Фича или плагин под тестом
 * @param options - Стабы, конфиг и транспорты
 * @returns Приложение с `call`/`get`/`close`
 *
 * @example
 * ```typescript
 * await using app = await testBundle(UsersFeature, {
 *   stubs: [[ILogger, noopLogger], stub(ChargeCard, async () => ({ id: 'c1' }))],
 *   transports: [http()],
 * });
 * ```
 */
export async function testBundle(
  bundle: Bundle,
  options: TestBundleOptions = {},
): Promise<TestApp> {
  // Мини-декларация вокруг единицы: тот же `makeApp`, что и в бою
  const app = makeApp({
    ...(bundle.role === 'plugin'
      ? { plugins: [bundle] }
      : { features: [bundle] }),
    transports: options.transports ?? [],
  });

  return await buildTest(app, {
    stubs: options.stubs,
    config: options.config,
  });
}
