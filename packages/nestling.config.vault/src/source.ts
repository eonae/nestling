/**
 * Источник конфигурации поверх Vault: секрет KV v2 читается одним запросом
 * на фазе 0.
 *
 * Координаты приходят значениями секции, объявленной в `needs`, поэтому
 * читалка поднимает Vault после источников, которые эти ключи покрывают.
 * Запрос идёт штатным `fetch` — клиента Vault в зависимостях пакета нет.
 */

import type { VaultCoordinates } from './config.js';

import type { ConfigSectionToken, ConfigSource } from '@nestlingjs/app';

/** Опции {@link vault} */
export interface VaultOptions {
  /**
   * Число дополнительных попыток при сетевом отказе и ответе `5xx`.
   *
   * Умолчание `0` — попытка одна. Пауза перед первым повтором 250 мс и
   * дальше удваивается. Ответы `401`, `403` и `404` повтора не вызывают:
   * сами они не проходят. Границу времени подъёма задаёт привязка опцией
   * `timeout`, а не источник.
   */
  readonly retries?: number;
}

/** Пауза перед первым повтором, мс; перед каждым следующим удваивается */
const FIRST_RETRY_DELAY = 250;

/** Ответ KV v2 в той части, которую читает источник */
interface KvResponse {
  readonly data?: { readonly data?: Record<string, unknown> };
}

/**
 * Отказ запроса к Vault.
 *
 * Флаг `retryable` отделяет временное от постоянного: повторяются сетевой
 * отказ и `5xx`, а отказ прав или отсутствие секрета сами не пройдут.
 */
class VaultRequestError extends Error {
  constructor(
    message: string,
    /** Отказ временный: повтор имеет смысл */
    readonly retryable: boolean,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'VaultRequestError';
  }
}

/** Адрес секрета KV v2; лишние слэши адреса отбрасываются */
const secretUrl = (coordinates: VaultCoordinates): string =>
  `${coordinates.addr.replaceAll(/\/+$/g, '')}/v1/${coordinates.mount}/data/${coordinates.path}`;

/**
 * Хранилище в тексте отказа: адрес, точка монтирования и путь.
 *
 * Учётных данных здесь нет и не будет: ошибка старта попадает в лог
 * целиком.
 */
const describeTarget = (coordinates: VaultCoordinates): string =>
  `Vault at ${coordinates.addr} (mount '${coordinates.mount}', path '${coordinates.path}')`;

/** Что означает ответ, который сам по себе не пройдёт */
const explainStatus = (status: number): string => {
  if (status === 401 || status === 403) {
    return `: the token is not allowed to read this path`;
  }

  if (status === 404) {
    return `: there is no secret at this path, or the mount is another one`;
  }

  return '';
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Один запрос секрета: рекорд `data.data` ответа или отказ */
const requestSecret = async (
  coordinates: VaultCoordinates,
): Promise<Record<string, unknown>> => {
  const target = describeTarget(coordinates);
  let response: Response;

  try {
    response = await fetch(secretUrl(coordinates), {
      headers: { 'X-Vault-Token': coordinates.token },
    });
  } catch (error) {
    throw new VaultRequestError(`${target} is unreachable`, true, error);
  }

  if (!response.ok) {
    throw new VaultRequestError(
      `${target} answered ${response.status}${explainStatus(response.status)}`,
      response.status >= 500,
    );
  }

  let payload: KvResponse;

  try {
    payload = (await response.json()) as KvResponse;
  } catch (error) {
    throw new VaultRequestError(
      `${target} answered with a body that is not JSON`,
      false,
      error,
    );
  }

  const data = payload.data?.data;

  if (!data) {
    throw new VaultRequestError(
      `${target} answered without 'data.data': the path holds no secret, or the mount runs the KV v1 engine`,
      false,
    );
  }

  return data;
};

/**
 * Читает секрет, повторяя временные отказы.
 *
 * Повтор принадлежит источнику, а не ядру: ядру нечем отличить временный
 * отказ от постоянного, а источник знает свой протокол.
 */
const readSecret = async (
  coordinates: VaultCoordinates,
  retries: number,
): Promise<Record<string, unknown>> => {
  let delay = FIRST_RETRY_DELAY;

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await requestSecret(coordinates);
    } catch (error) {
      if (attempt >= retries || !(error instanceof VaultRequestError)) {
        throw error;
      }

      if (!error.retryable) {
        throw error;
      }

      await sleep(delay);
      delay *= 2;
    }
  }
};

/**
 * Источник значений из секрета Vault.
 *
 * Секция координат приходит аргументом: `vault(VaultConfig)` берёт готовую
 * секцию пакета, а приложение с двумя хранилищами объявляет свою секцию
 * любой формы, подходящей под `VaultCoordinates`. Она же становится полем
 * `needs` источника, поэтому фаза 0 поднимает Vault после источников,
 * покрывающих её ключи.
 *
 * `init()` делает один запрос `GET {addr}/v1/{mount}/data/{path}` с
 * заголовком `X-Vault-Token` и запоминает рекорд `data.data`. Дальше
 * `get(key)` читает из этого рекорда, не обращаясь к сети.
 *
 * @param section - DI-токен секции координат
 * @param options - Число повторов при временном отказе
 * @returns Источник для `bind()`
 *
 * @example
 * ```typescript
 * await app.build().run({
 *   config: [
 *     bind(vault(VaultConfig, { retries: 2 }), { timeout: 3000 }),
 *     ...defaultSources,
 *   ],
 * });
 * ```
 */
export const vault = <T extends VaultCoordinates>(
  section: ConfigSectionToken<T>,
  options: VaultOptions = {},
): ConfigSource<T> => {
  const retries = options.retries ?? 0;
  let values: Record<string, unknown> = {};

  return {
    name: `vault(${section.keys.prefix})`,
    needs: section,
    init: async (coordinates) => {
      values = await readSecret(coordinates, retries);
    },
    get: (key) => values[key],
  };
};
