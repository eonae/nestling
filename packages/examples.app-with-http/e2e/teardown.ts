/* eslint-disable no-console --
 * Хуки прогона печатают границы e2e-сессии в вывод jest
 */
/**
 * Логирует завершение прогона e2e-тестов.
 *
 * Jest вызывает эту функцию один раз после того, как отработали
 * все тестовые файлы.
 */
export default async function globalTeardown() {
  console.log('✅ E2E tests completed');
}
