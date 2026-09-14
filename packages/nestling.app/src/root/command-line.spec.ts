/**
 * Разбор командной строки и текст справки.
 *
 * Обе функции чистые: тест читает и текст отказа, и текст справки, не
 * завершая процесса. Печать и выход стоят выше — в `parseArgs`.
 */

import type { CommandLineSpec } from './command-line.js';
import { helpText, parseCommandLine } from './command-line.js';

import { makeSwitch } from '@nestlingjs/container';
import { describe, expect, it } from 'vitest';

const Storage = makeSwitch('storage', ['s3', 'local']);
const Mail = makeSwitch('mail', ['log', 'smtp'], { default: 'log' });
const Docs = makeSwitch('docs', { default: 'on' });

/** Схема приложения с одним обязательным переключателем и двумя с умолчанием */
const spec: CommandLineSpec = {
  features: ['users', 'notifications'],
  switches: [Storage, Mail, Docs],
};

/** Схема без обязательных переключателей — ею проверяется всё остальное */
const easy: CommandLineSpec = {
  features: ['users', 'notifications'],
  switches: [Mail, Docs],
};

/** Разбирает командную строку так, как её увидит маркер `argv(process.argv)` */
const parse = (line: readonly string[], schema: CommandLineSpec = easy) =>
  parseCommandLine(['/usr/bin/node', '/app/main.js', ...line], schema);

/** Разобранный аргумент; справка на этом входе не запрашивалась */
const parsed = (line: readonly string[], schema: CommandLineSpec = easy) => {
  const result = parse(line, schema);

  if (result.help) {
    throw new Error('expected parsed args, got help');
  }

  return result.parsed;
};

describe('схема флагов из декларации', () => {
  it('пустая командная строка даёт тот же аргумент, что его отсутствие', () => {
    expect(parsed([])).toEqual({ includeDeps: false, given: {} });
  });

  it('первые два элемента отбрасываются', () => {
    expect(parsed(['--features', 'users']).features).toBe('users');
  });

  it('флаг переключателя назван его именем', () => {
    expect(parsed(['--mail', 'smtp']).given).toEqual({ mail: 'smtp' });
  });

  it('обе записи значения равнозначны', () => {
    expect(parsed(['--mail', 'smtp'])).toEqual(parsed(['--mail=smtp']));
  });

  it('список фич приходит одной строкой через запятую', () => {
    expect(parsed(['--features', 'users, notifications']).features).toBe(
      'users, notifications',
    );
  });

  it('флаг замыкания значения не принимает и взводит `includeDeps`', () => {
    expect(parsed(['--features', 'users', '--include-deps'])).toEqual({
      features: 'users',
      includeDeps: true,
      given: {},
    });
  });

  it('переключатель без флага в разобранный аргумент не попадает', () => {
    // Умолчание подставляет `resolveSwitchValues`: разбор отвечает за то,
    // что названо, а не за то, что объявлено
    expect(parsed(['--docs', 'off']).given).toEqual({ docs: 'off' });
  });
});

describe('строгие отказы разбора', () => {
  it('неизвестный флаг перечисляет известные', () => {
    expect(() => parse(['--featurs', 'users'])).toThrow(
      /Unknown flag '--featurs'.+--features, --include-deps, --mail, --docs, --help/s,
    );
  });

  it('значение вне словаря перечисляет допустимые', () => {
    expect(() => parse(['--mail', 'carrier-pigeon'])).toThrow(
      /Switch 'mail' has no value 'carrier-pigeon'.+'log', 'smtp'/s,
    );
  });

  it('флаг переключателя без значения называет его значения', () => {
    expect(() => parse(['--mail'])).toThrow(
      /Flag '--mail' needs a value.+'log', 'smtp'/s,
    );
  });

  it('следующий флаг значением не считается', () => {
    expect(() => parse(['--mail', '--docs', 'off'])).toThrow(
      /Flag '--mail' needs a value/,
    );
  });

  it('значение у флага замыкания отвергается', () => {
    expect(() => parse(['--include-deps=yes'])).toThrow(
      /Flag '--include-deps' takes no value, got 'yes'/,
    );
  });

  it('`--features` без значения называет объявленные фичи', () => {
    expect(() => parse(['--features'])).toThrow(
      /Flag '--features' needs a value.+users, notifications/s,
    );
  });

  it('позиционный аргумент отвергается и назван', () => {
    expect(() => parse(['users'])).toThrow(/Unexpected argument 'users'/);
  });

  it('переключатель без умолчания требует флага', () => {
    expect(() => parse(['--features', 'users'], spec)).toThrow(
      /Switch 'storage' has no default.+'--storage s3'.+'s3', 'local'/s,
    );
  });

  it('переданный флаг снимает требование', () => {
    expect(parsed(['--storage', 'local'], spec).given).toEqual({
      storage: 'local',
    });
  });
});

describe('текст справки', () => {
  const text = helpText('/app/main.js', spec);

  it('называет строку вызова с именем скрипта', () => {
    expect(text).toContain('Usage: node /app/main.js [options]');
  });

  it('перечисляет объявленные фичи', () => {
    expect(text).toContain('Features: users, notifications');
  });

  it('называет флаги выбора и справки', () => {
    expect(text).toContain('--features <all|name,…>');
    expect(text).toContain('--include-deps');
    expect(text).toContain('--help');
  });

  it('называет каждый переключатель с его значениями и умолчанием', () => {
    expect(text).toContain('--mail <log|smtp>');
    expect(text).toContain('Default: log');
    expect(text).toContain('--docs <on|off>');
  });

  it('переключатель без умолчания помечен обязательным', () => {
    expect(text).toMatch(/--storage <s3\|local>\s+Required/);
  });

  it('справка приходит исходом разбора, а не завершением процесса', () => {
    const result = parse(['--help'], spec);

    expect(result.help).toBe(true);
    expect(result.help && result.text).toBe(text);
  });

  it('справка сильнее соседнего отказа', () => {
    const result = parse(['--featurs', 'users', '--help'], spec);

    expect(result.help).toBe(true);
  });
});
