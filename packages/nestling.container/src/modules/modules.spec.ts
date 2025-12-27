import { isModule, makeModule } from './modules';

describe('Module helpers', () => {
  it('creates module via makeModule', () => {
    const moduleConfig = makeModule({
      name: 'TestModule',
      providers: [],
      imports: [],
      exports: [],
    });

    expect(moduleConfig.name).toBe('TestModule');
    expect(moduleConfig.providers).toEqual([]);
  });

  it('checks module shape with isModule', () => {
    expect(isModule(makeModule({ name: 'Example', providers: [] }))).toBe(true);
    expect(isModule({ name: 'no providers' })).toBe(true);
    expect(isModule(null)).toBe(false);
    expect(isModule({})).toBe(false);
  });
});
