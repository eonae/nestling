import { makeTokenFamily } from '@nestling/container';
import { transportNameOf } from '@nestling/pipeline';
import type { ITransport } from '@nestling/transport';
import { DEFAULT_INSTANCE } from '@nestling/transport';

/**
 * Семейство токенов HTTP-транспорта: один член на экземпляр.
 *
 * Экземпляров в сборке может быть несколько — публичный и админский
 * слушают разные порты, — поэтому токен параметризован именем экземпляра.
 * Декларация выбирает свой через `on:`; без него это `'default'`.
 *
 * @example
 * ```typescript
 * HttpTransport$('default'); // транспорт по умолчанию
 * HttpTransport$('admin');   // второй экземпляр
 * ```
 */
export const HttpTransport$ = makeTokenFamily<ITransport, [instance: string]>(
  'transport:http',
);

/** Короткое имя транспорта по умолчанию (`'http'`); его же видят слои пайплайна */
export const HTTP_TRANSPORT_NAME = transportNameOf(
  HttpTransport$(DEFAULT_INSTANCE),
);
