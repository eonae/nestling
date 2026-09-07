/**
 * Секция-семейство: префикс вычисляется из имени экземпляра, а `.keys`
 * адресуют ключи одного экземпляра.
 */

import { bootstrapConfig, configKernel } from './kernel.js';
import { makeConfig } from './section.js';
import { objectSource } from './source.js';

import { describe, expect, it } from '@jest/globals';
import type { InjectionToken } from '@nestling/container';
import {
  ContainerBuilder,
  factoryProvider,
  makeToken,
} from '@nestling/container';
import { z } from 'zod';

const ListenerConfig = makeConfig.family('listener', {
  port: z.coerce.number().int(),
  host: z.string().default('0.0.0.0'),
});

/** Значения секции одного экземпляра, доставаемые из графа */
interface ListenerValues {
  port: number;
  host: string;
}

/**
 * Строит граф, читающий секцию названного экземпляра.
 *
 * @param instance - Чью секцию читает граф
 * @param vars - Значения источника
 * @param boundTo - К чьим ключам привязан источник; без него — ко всем
 */
async function read(
  instance: string,
  vars: Record<string, string>,
  boundTo?: string,
): Promise<ListenerValues> {
  const section = ListenerConfig(instance);
  const values$ = makeToken<ListenerValues>(`listener-values:${instance}`);

  const reader = await bootstrapConfig([
    [
      objectSource(vars, 'test'),
      boundTo === undefined ? '*' : ListenerConfig(boundTo).keys,
    ],
  ]);

  const container = new ContainerBuilder()
    .register(configKernel(reader))
    .register(
      factoryProvider(values$, (values: ListenerValues) => values, [
        section as unknown as InjectionToken<ListenerValues>,
      ]),
    )
    .build();

  await container.init();

  return container.getOrThrow(values$);
}

describe('makeConfig.family — секция на экземпляр', () => {
  it('экземпляр по умолчанию читает ключи пакета без добавки', () => {
    expect([...ListenerConfig('default').keys.names]).toEqual([
      'LISTENER_PORT',
      'LISTENER_HOST',
    ]);
  });

  it('именованный экземпляр читает ключи со своей добавкой', () => {
    expect([...ListenerConfig('admin').keys.names]).toEqual([
      'LISTENER_ADMIN_PORT',
      'LISTENER_ADMIN_HOST',
    ]);
  });

  it('имя приводится к SCREAMING_SNAKE_CASE', () => {
    expect([...ListenerConfig('sideCar').keys.names]).toEqual([
      'LISTENER_SIDE_CAR_PORT',
      'LISTENER_SIDE_CAR_HOST',
    ]);

    expect([...ListenerConfig('read-model').keys.names]).toEqual([
      'LISTENER_READ_MODEL_PORT',
      'LISTENER_READ_MODEL_HOST',
    ]);
  });

  it('повторное объявление одного имени отдаёт тот же токен', () => {
    expect(ListenerConfig('admin')).toBe(ListenerConfig('admin'));
    expect(ListenerConfig('admin')).not.toBe(ListenerConfig('default'));
  });

  it('имя без букв и цифр отвергается', () => {
    expect(() => ListenerConfig('  ')).toThrow(/empty config section prefix/);
  });

  it('два экземпляра читают разные ключи', async () => {
    const vars = { LISTENER_PORT: '3000', LISTENER_ADMIN_PORT: '3001' };

    expect(await read('default', vars)).toEqual({
      port: 3000,
      host: '0.0.0.0',
    });
    expect(await read('admin', vars)).toEqual({ port: 3001, host: '0.0.0.0' });
  });

  it('привязка к `.keys` экземпляра не задевает соседа', async () => {
    // Источник привязан к ключам `admin`, а `LISTENER_PORT` в нём тоже
    // есть: экземпляр по умолчанию его не увидит
    const vars = { LISTENER_PORT: '3000', LISTENER_ADMIN_PORT: '3001' };

    expect(await read('admin', vars, 'admin')).toEqual({
      port: 3001,
      host: '0.0.0.0',
    });

    await expect(read('default', vars, 'admin')).rejects.toThrow(
      /LISTENER_PORT/,
    );
  });
});
