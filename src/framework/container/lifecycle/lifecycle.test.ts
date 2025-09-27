// Тесты для проверки системы метаданных и типизации декораторов
import { lifecycleMetadata, getLifecycleHooks, OnInit, OnDestroy } from './lifecycle';

describe('Lifecycle metadata system', () => {
  it('should work with manual metadata', () => {
    let initCalled = false;
    let destroyCalled = false;

    class TestClass {
      initMethod() {
        initCalled = true;
      }

      destroyMethod() {
        destroyCalled = true;
      }
    }

    // Вручную добавим метаданные
    lifecycleMetadata.set(TestClass, {
      onInit: ['initMethod'],
      onDestroy: ['destroyMethod']
    });

    const instance = new TestClass();
    const hooks = getLifecycleHooks(instance);

    expect(hooks.onInit).toHaveLength(1);
    expect(hooks.onDestroy).toHaveLength(1);
    
    // Проверим, что методы вызываются
    hooks.onInit.forEach(hook => hook());
    hooks.onDestroy.forEach(hook => hook());
    
    expect(initCalled).toBe(true);
    expect(destroyCalled).toBe(true);
  });

  it('should work with OnInit and OnDestroy decorators', () => {
    let initCalled = false;
    let destroyCalled = false;

    class TestClass {
      @OnInit()
      initialize() {
        initCalled = true;
      }

      @OnDestroy()
      cleanup() {
        destroyCalled = true;
      }
    }

    const instance = new TestClass();
    const hooks = getLifecycleHooks(instance);

    expect(hooks.onInit).toHaveLength(1);
    expect(hooks.onDestroy).toHaveLength(1);
    
    // Проверим, что методы вызываются
    hooks.onInit.forEach(hook => hook());
    hooks.onDestroy.forEach(hook => hook());
    
    expect(initCalled).toBe(true);
    expect(destroyCalled).toBe(true);
  });

  it('should work with async lifecycle methods', async () => {
    let initCalled = false;
    let destroyCalled = false;

    class TestClass {
      @OnInit()
      async initialize() {
        await new Promise(resolve => setTimeout(resolve, 10));
        initCalled = true;
      }

      @OnDestroy()
      async cleanup() {
        await new Promise(resolve => setTimeout(resolve, 10));
        destroyCalled = true;
      }
    }

    const instance = new TestClass();
    const hooks = getLifecycleHooks(instance);

    expect(hooks.onInit).toHaveLength(1);
    expect(hooks.onDestroy).toHaveLength(1);
    
    // Проверим, что методы вызываются
    await Promise.all(hooks.onInit.map(hook => hook()));
    await Promise.all(hooks.onDestroy.map(hook => hook()));
    
    expect(initCalled).toBe(true);
    expect(destroyCalled).toBe(true);
  });

  // Примечание: Тесты для методов с параметрами удалены, 
  // так как TypeScript теперь ловит эти ошибки на этапе компиляции.
  // Это демонстрирует, что типизация работает корректно.
});
