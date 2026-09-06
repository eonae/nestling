/* eslint-disable @typescript-eslint/no-empty-function */

import { Component } from '../providers/index.js';

import { getLifecycleHooks, OnStart } from './lifecycle.js';

describe('метаданные хуков жизненного цикла', () => {
  it('собирает хуки @OnStart', () => {
    @Component()
    class Started {
      @OnStart()
      start(): void {}
    }

    expect(getLifecycleHooks(new Started()).onStart).toHaveLength(1);
  });

  it('собирает несколько хуков одного класса', () => {
    @Component()
    class Multi {
      @OnStart()
      startOne(): void {}

      @OnStart()
      startTwo(): void {}
    }

    expect(getLifecycleHooks(new Multi()).onStart).toHaveLength(2);
  });

  it('не дублирует хуки при нескольких экземплярах', () => {
    @Component()
    class Repeated {
      @OnStart()
      start(): void {}
    }

    for (const instance of [new Repeated(), new Repeated(), new Repeated()]) {
      expect(getLifecycleHooks(instance).onStart).toHaveLength(1);
    }
  });

  it('других списков хуков не отдаёт', () => {
    @Component()
    class OnlyStart {
      @OnStart()
      start(): void {}
    }

    expect(Object.keys(getLifecycleHooks(new OnlyStart()))).toEqual([
      'onStart',
    ]);
  });

  it('класс без хуков даёт пустой список', () => {
    @Component()
    class Plain {}

    expect(getLifecycleHooks(new Plain()).onStart).toHaveLength(0);
  });
});
