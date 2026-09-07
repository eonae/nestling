/**
 * Типовые тесты переключателей состава.
 *
 * Файл не гоняется jest'ом: он и есть тест — если типы разойдутся, упадёт
 * `tsc` на сборке пакета. Негативные случаи закрыты `@ts-expect-error`:
 * исчезни ошибка компиляции, tsc сообщит о неиспользованной директиве.
 */

/* eslint-disable @typescript-eslint/no-unused-vars */

import { Component } from '../providers/index.js';

import { makeSwitch } from './make-switch.js';
import type {
  Branchable,
  Switch,
  SwitchBranch,
  ToggleSwitch,
} from './types.js';

@Component()
class S3Storage {
  readonly kind = 's3';
}

@Component()
class LocalStorage {
  readonly kind = 'local';
}

@Component()
class StorageMetrics {
  readonly kind = 'metrics';
}

const Storage = makeSwitch('storage', ['s3', 'local']);
const Metrics = makeSwitch('metrics');
const Debug = makeSwitch('debug', { default: 'off' });
const Tier = makeSwitch('tier', ['free', 'pro'], { default: 'free' });

/** Перечисление без умолчания: `default` типизирован как `undefined` */
const enumeration: Switch<'storage', 's3' | 'local', undefined> = Storage;

/** Двухпозиционный переключатель несёт `when` */
const toggle: ToggleSwitch<'metrics', undefined> = Metrics;

/** Умолчание попадает в тип: по нему поле аргумента сборки необязательно */
const withDefault: Switch<'tier', 'free' | 'pro', 'free'> = Tier;

/** Умолчание вне словаря не компилируется */
// @ts-expect-error 'gcs' не входит в значения переключателя
const wrongDefault = makeSwitch('storage', ['s3', 'local'], { default: 'gcs' });

/** Полная таблица принимается */
const branch: SwitchBranch<typeof S3Storage | typeof LocalStorage> =
  Storage.pick({ s3: [S3Storage], local: [LocalStorage] });

/** Неполная таблица не компилируется */
// @ts-expect-error таблица обязана перечислить все значения
const incomplete = Storage.pick({ s3: [S3Storage] });

/** Лишнее значение в таблице не компилируется */
const extra = Storage.pick({
  s3: [S3Storage],
  local: [LocalStorage],
  // @ts-expect-error 'gcs' не значение переключателя
  gcs: [S3Storage],
});

/** `when` — сокращение двухпозиционного переключателя */
const shortcut: SwitchBranch<typeof StorageMetrics> =
  Metrics.when(StorageMetrics);

/** У перечисления `when` нет: ветка «включено/выключено» ему не выражается */
// @ts-expect-error у перечисления единственный метод — pick
const noWhen = Storage.when(S3Storage);

/** Ветка встаёт в список наравне со своими элементами */
const providers: readonly Branchable<typeof S3Storage>[] = [
  S3Storage,
  Storage.pick({ s3: [S3Storage], local: [] }),
];

/** Вложенная ветка раскрывается в тот же тип, что и внешняя */
const nested: readonly Branchable<typeof S3Storage>[] = [
  Storage.pick({ s3: [S3Storage, Debug.when(S3Storage)], local: [] }),
];

/** Ветка чужого типа в списке не компилируется */
const foreign: readonly Branchable<typeof S3Storage>[] = [
  // @ts-expect-error ветка приводит LocalStorage, а список принимает S3Storage
  Storage.pick({ s3: [LocalStorage], local: [LocalStorage] }),
];

/** Список без веток ветку не принимает */
const plain: readonly (typeof S3Storage)[] = [
  // @ts-expect-error эта позиция веток не принимает
  Metrics.when(S3Storage),
];
