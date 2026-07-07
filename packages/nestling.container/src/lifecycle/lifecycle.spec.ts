/* eslint-disable @typescript-eslint/no-empty-function */

import { makeToken } from '../common';
import { Injectable } from '../providers';

import { getLifecycleHooks, OnDestroy, OnInit } from './lifecycle';

describe('Lifecycle metadata system', () => {
  it('collects OnInit hooks', () => {
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

  it('collects OnDestroy hooks', () => {
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

  it('does not duplicate hooks across multiple instances', () => {
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

  it('collects multiple lifecycle hooks', () => {
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
});
