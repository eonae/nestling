/**
 * Шаблон — чистая функция, поэтому его тест не поднимает ни контейнера,
 * ни базы.
 */

import { welcome } from './templates.js';

import { describe, expect, it } from '@jest/globals';

describe('welcome', () => {
  it('обращается к пользователю по имени', () => {
    const letter = welcome({ name: 'Carol' });

    expect(letter.subject).toBe('Welcome aboard');
    expect(letter.body).toContain('Hi Carol');
  });
});
