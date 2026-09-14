/**
 * Типовые тесты зависимости источника от секции.
 *
 * Файл не гоняется vitest'ом: он и есть тест — если типы разойдутся, упадёт
 * `tsc` на проверке пакета. Негативные случаи закрыты `@ts-expect-error`:
 * исчезни ошибка компиляции, tsc сообщит о неиспользованной директиве.
 */

/* eslint-disable @typescript-eslint/no-unused-vars */

import type { Config } from './families.js';
import { makeConfig } from './section.js';
import type { Binding, ConfigSource } from './source.js';
import { bind, dotenv, env } from './source.js';

import { z } from 'zod';

const VaultConfig = makeConfig('typetestVault', {
  addr: z.url(),
  token: z.string(),
});

type VaultValues = Config<typeof VaultConfig>;

const OtherConfig = makeConfig('typetestOther', { endpoint: z.string() });

/** Источник без зависимостей объявляет `init()` без параметров */
const fileSource: ConfigSource = {
  name: 'file',
  init: async () => {
    await Promise.resolve();
  },
  // eslint-disable-next-line unicorn/no-useless-undefined
  get: () => undefined,
};

/** Источники ядра привязываются как до появления `needs` */
const defaults: readonly Binding[] = [
  bind(env()),
  bind(dotenv('.env'), { optional: true }),
];

/** Источник с `needs` получает значения своей секции проверенными */
const vaultSource: ConfigSource<VaultValues> = {
  name: 'vault',
  needs: VaultConfig,
  init: (values) => {
    const addr: string = values.addr;
    const token: string = values.token;
  },
  // eslint-disable-next-line unicorn/no-useless-undefined
  get: () => undefined,
};

/** Список привязок однороден, какой бы формы ни были координаты */
const bindings: readonly Binding[] = [bind(vaultSource), bind(fileSource)];

/** Секция чужой формы в `needs` не компилируется */
const foreignNeeds: ConfigSource<VaultValues> = {
  // @ts-expect-error секция объявляет `endpoint`, а не `addr` и `token`
  needs: OtherConfig,
  init: (values) => {
    const addr: string = values.addr;
  },
  // eslint-disable-next-line unicorn/no-useless-undefined
  get: () => undefined,
};

/** Форма аргумента `init` сверяется с секцией */
const foreignInit: ConfigSource<VaultValues> = {
  needs: VaultConfig,
  // @ts-expect-error значения секции не несут поля `endpoint`
  init: (values: { endpoint: string }) => {
    const endpoint: string = values.endpoint;
  },
  // eslint-disable-next-line unicorn/no-useless-undefined
  get: () => undefined,
};

/** Поля секции доступны только те, что она объявила */
const strayField: ConfigSource<VaultValues> = {
  needs: VaultConfig,
  init: (values) => {
    // @ts-expect-error поля `endpoint` у секции нет
    const endpoint: string = values.endpoint;
  },
  // eslint-disable-next-line unicorn/no-useless-undefined
  get: () => undefined,
};
