import { ContainerBuilder } from '../builder/index.js';
import { makeModule } from '../modules/index.js';
import { Component } from '../providers/index.js';

import { makeSwitch } from './make-switch.js';
import { branchCandidates, resolveBranches, switchesUsed } from './resolve.js';

import type { StandardSchemaV1 } from '@standard-schema/spec';

describe('makeSwitch', () => {
  it('объявляет двухпозиционный переключатель без умолчания', () => {
    const Metrics = makeSwitch('metrics');

    expect(Metrics.name).toBe('metrics');
    expect(Metrics.values).toEqual(['on', 'off']);
    expect(Metrics.default).toBeUndefined();
  });

  it('объявляет двухпозиционный переключатель с умолчанием', () => {
    const Debug = makeSwitch('debug', { default: 'off' });

    expect(Debug.values).toEqual(['on', 'off']);
    expect(Debug.default).toBe('off');
  });

  it('объявляет перечисление с умолчанием и без', () => {
    expect(makeSwitch('storage', ['s3', 'local']).default).toBeUndefined();
    expect(
      makeSwitch('storage', ['s3', 'local'], { default: 's3' }).default,
    ).toBe('s3');
  });

  it('отвергает пустое имя', () => {
    expect(() => makeSwitch('  ')).toThrow(/non-empty string/);
  });

  it('отвергает меньше двух различных значений', () => {
    expect(() => makeSwitch('storage', ['s3'])).toThrow(/two distinct values/);
    expect(() => makeSwitch('storage', ['s3', 's3'])).toThrow(
      /two distinct values/,
    );
  });

  it('отвергает умолчание вне словаря', () => {
    expect(() =>
      makeSwitch('storage', ['s3', 'local'], { default: 'gcs' as 's3' }),
    ).toThrow(/'s3', 'local'/);
  });

  it('не имеет побочных эффектов: два вызова дают независимые значения', () => {
    const first = makeSwitch('storage', ['s3', 'local']);
    const second = makeSwitch('storage', ['s3', 'local']);

    expect(first).not.toBe(second);
  });
});

/** Результат схемы: спека синхронна, поэтому промиса здесь не бывает */
function read(
  declared: { schema: StandardSchemaV1<string, string> },
  value?: unknown,
): StandardSchemaV1.Result<string> {
  return declared.schema['~standard'].validate(
    value,
  ) as StandardSchemaV1.Result<string>;
}

/** Сообщения отказа: они лежат в `issues`, а не в значении */
const issuesOf = (result: StandardSchemaV1.Result<string>): string[] =>
  (result.issues ?? []).map(({ message }) => message);

describe('Switch.schema', () => {
  const Storage = makeSwitch('storage', ['s3', 'local']);
  const Debug = makeSwitch('debug', { default: 'off' });

  it('реализует Standard Schema v1', () => {
    expect(Storage.schema['~standard'].version).toBe(1);
  });

  it('принимает значение из словаря', () => {
    expect(read(Storage, 'local')).toEqual({ value: 'local' });
  });

  it('подставляет умолчание вместо отсутствующего значения', () => {
    expect(read(Debug)).toEqual({ value: 'off' });
  });

  it('перечисляет допустимые значения в отказе', () => {
    expect(issuesOf(read(Storage, 'gcs'))).toEqual([
      expect.stringContaining("'s3', 'local'"),
    ]);
  });

  it('отвергает отсутствие значения, когда умолчания нет', () => {
    expect(issuesOf(read(Storage))).toEqual([
      expect.stringContaining("Switch 'storage'"),
    ]);
  });
});

describe('pick и when', () => {
  const Storage = makeSwitch('storage', ['s3', 'local']);
  const Metrics = makeSwitch('metrics');

  it('раскрывается в элементы выбранной ветки', () => {
    const branch = Storage.pick({ s3: ['s3-client', 's3-store'], local: 'fs' });

    expect(resolveBranches([branch], { storage: 's3' })).toEqual([
      's3-client',
      's3-store',
    ]);
    expect(resolveBranches([branch], { storage: 'local' })).toEqual(['fs']);
  });

  it('пустая ветка раскрывается в ноль элементов', () => {
    const branch = Storage.pick({ s3: ['s3-store'], local: [] });

    expect(resolveBranches([branch], { storage: 'local' })).toEqual([]);
  });

  it('`when` равносилен `pick({ on, off: [] })`', () => {
    const branch = Metrics.when(['a', 'b']);

    expect(resolveBranches([branch], { metrics: 'on' })).toEqual(['a', 'b']);
    expect(resolveBranches([branch], { metrics: 'off' })).toEqual([]);
  });

  it('у перечисления `when` нет', () => {
    expect((Storage as { when?: unknown }).when).toBeUndefined();
  });

  it('ветка читается как данные, а не выполняется', () => {
    const branch = Storage.pick({ s3: ['s3-store'], local: ['fs'] });

    expect(typeof branch).toBe('object');
    expect(Object.keys(branch)).toEqual([]);
    expect(branchCandidates([branch])).toEqual(['s3-store', 'fs']);
  });
});

describe('resolveBranches', () => {
  const Storage = makeSwitch('storage', ['s3', 'local']);
  const Debug = makeSwitch('debug', { default: 'off' });

  it('сохраняет порядок и оставляет обычные элементы на месте', () => {
    const items = [
      'head',
      Storage.pick({ s3: ['s3-store'], local: ['fs'] }),
      'tail',
    ];

    expect(resolveBranches(items, { storage: 's3' })).toEqual([
      'head',
      's3-store',
      'tail',
    ]);
  });

  it('раскрывает вложенную ветку тем же проходом', () => {
    const items = [
      Storage.pick({
        s3: ['s3-store', Debug.when('dump')],
        local: ['fs'],
      }),
    ];

    expect(resolveBranches(items, { storage: 's3', debug: 'on' })).toEqual([
      's3-store',
      'dump',
    ]);
    expect(resolveBranches(items, { storage: 's3', debug: 'off' })).toEqual([
      's3-store',
    ]);
  });

  it('называет переключатель и опцию, когда значения нет', () => {
    const items = [Storage.pick({ s3: ['s3-store'], local: ['fs'] })];

    expect(() => resolveBranches(items, {})).toThrow(/switch 'storage'/);
    expect(() => resolveBranches(items, {})).toThrow(/'switches' option/);
  });

  it('отвергает значение вне словаря переключателя', () => {
    const items = [Storage.pick({ s3: ['s3-store'], local: ['fs'] })];

    expect(() => resolveBranches(items, { storage: 'gcs' })).toThrow(
      /'s3', 'local'/,
    );
  });

  it('пустой список и отсутствующий список дают пустой результат', () => {
    expect(resolveBranches([], {})).toEqual([]);
    expect(resolveBranches(undefined, {})).toEqual([]);
  });
});

describe('ветки в модулях контейнера', () => {
  const Storage = makeSwitch('storage', ['s3', 'local']);

  @Component()
  class S3Storage {}

  @Component()
  class LocalStorage {}

  @Component()
  class DebugProbe {}

  const storageModule = makeModule({
    name: 'module:storage',
    providers: [Storage.pick({ s3: [S3Storage], local: [LocalStorage] })],
  });

  it('регистрирует провайдеры выбранной ветки и только их', () => {
    const container = new ContainerBuilder({ switches: { storage: 's3' } })
      .register(storageModule)
      .build();

    expect(container.has(S3Storage)).toBe(true);
    expect(container.has(LocalStorage)).toBe(false);
  });

  it('раскрывает ветку в `dependsOn`', () => {
    const probes = makeModule({
      name: 'module:probes',
      providers: [DebugProbe],
    });
    const root = makeModule({
      name: 'module:root',
      dependsOn: [Storage.pick({ s3: [probes], local: [] })],
    });

    const withProbes = new ContainerBuilder({ switches: { storage: 's3' } })
      .register(root)
      .build();
    const without = new ContainerBuilder({ switches: { storage: 'local' } })
      .register(root)
      .build();

    expect(withProbes.has(DebugProbe)).toBe(true);
    expect(without.has(DebugProbe)).toBe(false);
  });

  it('не копирует модуль: то же значение регистрируется один раз', () => {
    const owner = makeModule({
      name: 'module:owner',
      dependsOn: [storageModule],
    });

    expect(() =>
      new ContainerBuilder({ switches: { storage: 's3' } })
        .register(storageModule, owner)
        .build(),
    ).not.toThrow();
  });

  it('отвергает ветку, когда значений билдеру не передали', () => {
    expect(() => new ContainerBuilder().register(storageModule)).toThrow(
      /switch 'storage'.*'switches' option/s,
    );
  });
});

describe('switchesUsed', () => {
  const Storage = makeSwitch('storage', ['s3', 'local']);
  const Debug = makeSwitch('debug', { default: 'off' });

  it('перечисляет переключатели веток, включая вложенные, без повторов', () => {
    const items = [
      'head',
      Storage.pick({ s3: [Debug.when('dump')], local: [] }),
      Storage.pick({ s3: [], local: [] }),
    ];

    expect(switchesUsed(items)).toEqual([Storage, Debug]);
  });
});
