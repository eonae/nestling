/**
 * Формат тела отказа: сборка документа RFC 9457 и разбор его типа.
 *
 * Что документ доходит до клиента именно таким, проверяют интеграционные
 * спеки `@nestlingjs/transport.http`.
 */

import { categories } from '../status.js';

import {
  failCodeOf,
  PROBLEM_MEDIA_TYPE,
  PROBLEM_TYPE_PREFIX,
  problemOf,
  problemTitleOf,
  problemTypeOf,
} from './problem.js';

import { describe, expect, it } from '@jest/globals';

describe('problemOf: документ из деталей отказа', () => {
  it('раскладывает отказ по членам документа', () => {
    expect(
      problemOf(
        {
          error: 'User 9 not found',
          code: 'not_found:user',
          details: { id: '9' },
        },
        404,
      ),
    ).toEqual({
      type: 'urn:error:not_found:user',
      title: 'Not Found',
      status: 404,
      detail: 'User 9 not found',
      details: { id: '9' },
    });
  });

  it('не пишет члена details у отказа без деталей', () => {
    const document = problemOf(
      { error: 'Email taken', code: 'conflict:email_taken' },
      409,
    );

    expect(document).toEqual({
      type: 'urn:error:conflict:email_taken',
      title: 'Conflict',
      status: 409,
      detail: 'Email taken',
    });
    expect('details' in document).toBe(false);
  });

  it('пишет stack только переданный', () => {
    const bare = problemOf(
      { error: 'Internal server error', code: 'internal_error' },
      500,
    );
    const exposed = problemOf(
      { error: 'boom', code: 'internal_error', stack: 'Error: boom\n  at …' },
      500,
    );

    expect('stack' in bare).toBe(false);
    expect(exposed.stack).toBe('Error: boom\n  at …');
  });

  it('не пишет полей прежнего формата', () => {
    const document = problemOf(
      { error: 'Bad request', code: 'bad_request' },
      400,
    );

    expect(Object.keys(document).sort()).toEqual([
      'detail',
      'status',
      'title',
      'type',
    ]);
  });
});

describe('problemTypeOf и failCodeOf', () => {
  it('проходит код с уточнением туда и обратно', () => {
    const type = problemTypeOf('conflict:email_taken');

    expect(type).toBe('urn:error:conflict:email_taken');
    expect(failCodeOf(type)).toBe('conflict:email_taken');
  });

  it('не узнаёт чужой тип проблемы', () => {
    expect(failCodeOf('https://example.com/errors/not-found')).toBeUndefined();
    expect(failCodeOf('about:blank')).toBeUndefined();
  });

  it('не узнаёт не-строку', () => {
    const absent: unknown = undefined;

    expect(failCodeOf(absent)).toBeUndefined();
    expect(failCodeOf(42)).toBeUndefined();
    expect(failCodeOf({ type: 'urn:error:not_found' })).toBeUndefined();
  });
});

describe('problemTitleOf: фраза статуса', () => {
  it('даёт фразу каждой категории', () => {
    for (const category of categories) {
      expect(problemTitleOf(category)).not.toBe('');
    }

    expect(problemTitleOf('not_found')).toBe('Not Found');
    expect(problemTitleOf('internal_error')).toBe('Internal Server Error');
    expect(problemTitleOf('timeout')).toBe('Gateway Timeout');
  });
});

describe('константы формата', () => {
  it('называют медиатип и префикс типа', () => {
    expect(PROBLEM_MEDIA_TYPE).toBe('application/problem+json');
    expect(PROBLEM_TYPE_PREFIX).toBe('urn:error:');
  });
});
