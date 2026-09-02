import { isModule, makeModule } from './modules';

describe('функции модулей', () => {
  it('создаёт модуль через makeModule', () => {
    const moduleConfig = makeModule({
      name: 'TestModule',
      providers: [],
      dependsOn: [],
    });

    expect(moduleConfig.name).toBe('TestModule');
    expect(moduleConfig.providers).toEqual([]);
  });

  it('проверяет форму модуля через isModule', () => {
    expect(isModule(makeModule({ name: 'Example', providers: [] }))).toBe(true);
    expect(isModule({ name: 'no providers' })).toBe(true);
    expect(isModule(null)).toBe(false);
    expect(isModule({})).toBe(false);
  });
});
