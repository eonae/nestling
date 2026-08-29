/* eslint-disable @typescript-eslint/no-empty-function */

import { makeToken } from '../common';
import { Injectable } from '../providers';

import { getLifecycleHooks, OnDestroy, OnInit, OnStart } from './lifecycle';

describe('метаданные хуков жизненного цикла', () => {
  it('собирает хуки @OnInit', () => {
    const token = makeToken('Service');

    @Injectable(token, [])
    class Service {
      @OnInit()
      init(): void {}
    }

    const hooks = getLifecycleHooks(new Service());

    expect(hooks.onInit).toHaveLength(1);
    expect(hooks.onDestroy).toHaveLength(0);
  });

  it('собирает хуки @OnDestroy', () => {
    const token = makeToken('Cleanup');

    @Injectable(token, [])
    class Cleanup {
      @OnDestroy()
      dispose(): void {}
    }

    const hooks = getLifecycleHooks(new Cleanup());

    expect(hooks.onInit).toHaveLength(0);
    expect(hooks.onDestroy).toHaveLength(1);
  });

  it('не дублирует хуки при нескольких экземплярах', () => {
    const token = makeToken('Repeated');

    @Injectable(token, [])
    class Repeated {
      @OnInit()
      init(): void {}

      @OnDestroy()
      dispose(): void {}
    }

    const instances = [new Repeated(), new Repeated(), new Repeated()];

    for (const instance of instances) {
      const hooks = getLifecycleHooks(instance);

      expect(hooks.onInit).toHaveLength(1);
      expect(hooks.onDestroy).toHaveLength(1);
    }
  });

  it('собирает несколько хуков одного вида', () => {
    const token = makeToken('Multi');

    @Injectable(token, [])
    class Multi {
      @OnInit()
      initOne(): void {}

      @OnInit()
      initTwo(): void {}

      @OnDestroy()
      destroyOne(): void {}

      @OnDestroy()
      destroyTwo(): void {}
    }

    const hooks = getLifecycleHooks(new Multi());

    expect(hooks.onInit).toHaveLength(2);
    expect(hooks.onDestroy).toHaveLength(2);
  });

  it('собирает хуки @OnStart', () => {
    const token = makeToken('Started');

    @Injectable(token, [])
    class Started {
      @OnStart()
      start(): void {}
    }

    const hooks = getLifecycleHooks(new Started());

    expect(hooks.onInit).toHaveLength(0);
    expect(hooks.onStart).toHaveLength(1);
    expect(hooks.onDestroy).toHaveLength(0);
  });

  it('собирает все три вида хуков одного класса', () => {
    const token = makeToken('ThreePhase');

    @Injectable(token, [])
    class ThreePhase {
      @OnInit()
      init(): void {}

      @OnStart()
      start(): void {}

      @OnDestroy()
      dispose(): void {}
    }

    const hooks = getLifecycleHooks(new ThreePhase());

    expect(hooks.onInit).toHaveLength(1);
    expect(hooks.onStart).toHaveLength(1);
    expect(hooks.onDestroy).toHaveLength(1);
  });

  it('не дублирует хуки @OnStart при нескольких экземплярах', () => {
    const token = makeToken('RepeatedStart');

    @Injectable(token, [])
    class RepeatedStart {
      @OnStart()
      start(): void {}
    }

    const instances = [
      new RepeatedStart(),
      new RepeatedStart(),
      new RepeatedStart(),
    ];

    for (const instance of instances) {
      expect(getLifecycleHooks(instance).onStart).toHaveLength(1);
    }
  });
});
