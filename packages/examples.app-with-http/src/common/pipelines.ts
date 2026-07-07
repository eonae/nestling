import { definePipeline, validate } from '@nestling/pipeline';

/**
 * Базовый pipeline с валидацией
 *
 * ✅ Содержит validate() - можно использовать с endpoint'ами, у которых есть input схема
 */
export const basePipeline = definePipeline().use(validate());

/**
 * Pipeline без валидации (для endpoint'ов без input или streaming)
 *
 * ❌ НЕ содержит validate() - можно использовать только с endpoint'ами БЕЗ input схемы
 */
export const noValidationPipeline = definePipeline();
