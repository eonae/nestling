import { definePipeline, validate, withTiming } from '@nestling/pipeline';

/**
 * Базовый pipeline с валидацией
 */
export const basePipeline = definePipeline().use(withTiming()).use(validate());

/**
 * Pipeline без валидации (для endpoint'ов без input или streaming)
 */
export const noValidationPipeline = definePipeline().use(withTiming());
