/**
 * Добавляет timestamp в input
 * Используется в тестах для проверки накопления полей
 */
export const withTiming = async () => ({ timestamp: Date.now() });
