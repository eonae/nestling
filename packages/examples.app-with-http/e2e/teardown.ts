/**
 * Логирует завершение прогона e2e-тестов.
 *
 * Jest вызывает эту функцию один раз после того, как отработали
 * все тестовые файлы.
 */
export default async function globalTeardown() {
  console.log('✅ E2E tests completed');
}

