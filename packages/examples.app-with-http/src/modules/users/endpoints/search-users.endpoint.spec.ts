import type { ILoggerService } from '../../logger/logger.service';
import { SearchQueryRequired } from '../user.errors';
import type { UserService } from '../user.service';

import { SearchUsersHandler } from './search-users.endpoint';

import { Ok } from '@nestling/pipeline';
import { mock } from 'jest-mock-extended';

describe('SearchUsersHandler', () => {
  let endpoint: SearchUsersHandler;
  let userService: jest.Mocked<UserService>;
  let logger: jest.Mocked<ILoggerService>;

  beforeEach(() => {
    userService = mock<UserService>();
    logger = mock<ILoggerService>();

    endpoint = new SearchUsersHandler(userService, logger);
  });

  describe('Успешные сценарии', () => {
    it('должен найти пользователей с заголовками', async () => {
      const users = [{ id: '1', name: 'Alice', email: 'alice@test.com' }];
      userService.search.mockResolvedValue(users);

      const result = await endpoint.handle({ q: 'Alice' });

      if (result instanceof Ok) {
        expect(result.value).toEqual(users);
        expect(result.headers).toHaveProperty('X-Total-Count', '1');
        expect(result.headers).toHaveProperty('Cache-Control', 'max-age=60');
        expect(userService.search).toHaveBeenCalledWith('Alice');
      } else {
        expect(result).toBeInstanceOf(Ok);
      }
    });

    it('должен вернуть пустой массив если ничего не найдено', async () => {
      userService.search.mockResolvedValue([]);

      const result = await endpoint.handle({ q: 'NonExistent' });

      if (result instanceof Ok) {
        expect(result.value).toEqual([]);
        expect(result.headers).toHaveProperty('X-Total-Count', '0');
      } else {
        expect(result).toBeInstanceOf(Ok); // Will fail
      }
    });
  });

  describe('Ошибочные сценарии', () => {
    it('должен вернуть SearchQueryRequired если query отсутствует', async () => {
      const result = await endpoint.handle({ q: '' });

      expect(SearchQueryRequired.is(result)).toBe(true);
      expect(result).toMatchObject({
        status: 'BAD_REQUEST',
        code: 'SEARCH_QUERY_REQUIRED',
      });
    });
  });
});
