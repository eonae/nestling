/**
 * `testModule` — один модуль в изоляции.
 */

import type { TestApp, TestStub } from './app.js';
import { assembleTest } from './app.js';
import type { TestConfig } from './config.js';

import type { Module, Provider } from '@nestling/container';
import type { ITransport } from '@nestling/transport';

/** Словарь `testModule` */
export interface TestModuleOptions {
  /**
   * Поставка недостающего: пары «токен → значение».
   *
   * Для модуля в изоляции это не подмена, а именно поставка — сосед, чьи
   * провайдеры сюда не приехали. Форма совместима с будущим
   * `stub(Contract, impl)`.
   */
  stubs?: readonly TestStub[];

  /** Конфиг: источник, одна привязка или их список */
  config?: TestConfig;

  /** Транспорты для ручек модуля — перечисляются явно, как и в бою */
  transports?: readonly Provider<ITransport>[];
}

/**
 * Поднимает мини-приложение вокруг одного модуля.
 *
 * Регистрируются: сам модуль (с его `imports`), kernel-модуль конфига (его
 * корень регистрирует всегда) и перечисленные стабы. Дальше — те же фазы
 * 0–3 и тот же {@link TestApp}, что у `assembleTest`.
 *
 * Живёт внутри пакета модуля, поэтому его внутренние токены видны тесту
 * без добавления в публичный экспорт.
 *
 * Неудовлетворённые импорты обязаны быть застабаны явно: сборка падает
 * ошибкой, перечисляющей **все** недостающие токены с потребителем
 * каждого, а не первый попавшийся.
 *
 * @param module - Модуль под тестом
 * @param options - Стабы, конфиг и транспорты
 * @returns Приложение с `call`/`get`/`close`
 *
 * @example
 * ```typescript
 * await using app = await testModule(UsersModule, {
 *   stubs: [[ILogger, noopLogger]],
 *   transports: [http()],
 * });
 * ```
 */
export async function testModule(
  module: Module,
  options: TestModuleOptions = {},
): Promise<TestApp> {
  return await assembleTest({
    modules: [module],
    stubs: options.stubs,
    config: options.config,
    transports: options.transports,
  });
}
