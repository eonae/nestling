// Простой тест для проверки системы метаданных
import { lifecycleMetadata, getLifecycleHooks } from './lifecycle';

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
      onInitMethods: ['initMethod'],
      onDestroyMethods: ['destroyMethod']
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
});
