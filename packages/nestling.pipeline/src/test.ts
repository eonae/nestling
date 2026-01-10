import type { Logger } from './middlewares/logging';
import { withLogging } from './middlewares/logging';
import { withTiming } from './middlewares/timing';
import { definePipeline } from './core';
import { validate, withIdentity } from './middlewares';

interface User {
  id: string;
  name: string;
  email: string;
}

const pipeline = definePipeline()
  .use(withTiming)
  .use(withLogging(console as Logger))
  .use(
    withIdentity<User>(async () => {
      return {
        id: '1',
        name: 'John Doe',
        email: 'john.doe@example.com',
      };
    }),
  )
  .use(validate());
