# Project setup

What builds and runs a Nestling service: one `tsconfig.json`, four scripts
and one ESLint plugin. There is no template and no generator — the
framework owns the code, not the build.

## tsconfig.json

```json
{
  "compilerOptions": {
    "target": "es2023",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "lib": ["es2023", "esnext.disposable"],
    "types": ["node"],
    "customConditions": ["testing"],
    "strict": true,
    "useDefineForClassFields": true,
    "outDir": "dist",
    "rootDir": "src",
    "sourceMap": true
  },
  "include": ["src"]
}
```

- **`module: "nodenext"`.** `tsc` copies an import specifier into `dist`
  verbatim, and Node ESM resolves neither a directory nor a name without an
  extension. So every relative import carries `.js` — `./users.feature.js`,
  never `./users.feature` — and `nodenext` is the setting that has the
  compiler check it: a missing extension is TS2835. With
  `moduleResolution: "bundler"` the same file compiles and the build then
  fails on its first import.
- **`esnext.disposable` in `lib`.** `assembleTest` returns a value held by
  `await using`; without the library the disposal protocol has no types.
- **No `experimentalDecorators`, no `emitDecoratorMetadata`.** Nestling uses
  standard decorators and reads nothing from metadata: a dependency list is
  a value written next to the class. `reflect-metadata` is not installed.
- **`customConditions: ["testing"]`.** The types of `@nestlingjs/testing`
  reach into `@nestlingjs/app/testing`, and that subpath sits behind an
  export condition. Without the option the typecheck stops with TS2307 on a
  file inside `node_modules`.

## package.json

```json
{
  "type": "module",
  "engines": { "node": ">=24" },
  "scripts": {
    "build": "tsc",
    "start": "node dist/main.js",
    "dev": "tsx watch src/main.ts",
    "test": "node --import tsx --test --conditions=testing \"src/**/*.test.ts\"",
    "lint": "eslint ."
  }
}
```

`"type": "module"` is required: the framework ships ESM only.

**`dev` runs `tsx`, not `node`.** Node strips types, it does not compile
them, and a decorator is syntax V8 does not have: `node src/main.ts` stops
at the first `@Component` with `SyntaxError: Invalid or unexpected token`.
`tsx` compiles instead of stripping, and brings `watch` with it.

The same holds for tests, which is why `test` goes through `--import tsx`
as well. The alternative is to build first and run the tests out of `dist`.

## The testing condition

`@nestlingjs/testing` imports `@nestlingjs/app/testing`, a subpath declared
under the export condition `testing`. Production code therefore cannot
reach the test seam at all — the resolution fails — and every runner has to
turn the condition on.

| Runner | How |
|---|---|
| `node:test` | `node --import tsx --test --conditions=testing` |
| jest | `testEnvironmentOptions: { customExportConditions: ['testing', 'node', 'node-addons'] }` |

Without it the first import of `@nestlingjs/testing` throws
`ERR_PACKAGE_PATH_NOT_EXPORTED`, naming `./testing` and
`@nestlingjs/app`.

## ESLint

```bash
npm install --save-dev @nestlingjs/eslint-plugin
```

```javascript
// eslint.config.js
import nestling from '@nestlingjs/eslint-plugin';
import tseslint from 'typescript-eslint';

export default [
  { ignores: ['dist'] },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    plugins: { '@nestlingjs': nestling },
    rules: {
      // `static acquire(config, logger, _signal)`: the signature of a
      // resource is a contract, and a parameter it does not read stays
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@nestlingjs/import-through-barrel': 'error',
      '@nestlingjs/endpoint-has-layer': [
        'warn',
        { layer: 'observability', constructorName: 'httpEndpoint' },
      ],
      '@nestlingjs/dependency-list': 'warn',
    },
  },
];
```

- `import-through-barrel` catches an import that reaches inside another
  module past its `index.ts`. A folder without an `index.ts` is not a
  boundary and the rule says nothing about it. The check is complete, so
  the level is `error`.
- `endpoint-has-layer` catches a declaration that does not compose the
  named layer. A pipeline is a value and can travel through a factory, so
  the check is incomplete by design and the level is `warn`. The guarantee
  is the policy in the root — `everyEndpoint({ … }).hasLayer(observability)`
  — which stops the process instead of printing a hint.
- `dependency-list` catches a decorator list that does not match the
  constructor parameters: `@Component()` next to a non-empty constructor,
  a missing token, an extra one. The expected list is derived from the
  parameter types by name — `Database` for a class, `UsersRepository$` for
  an interface whose token is in scope, `Logger$.auto` for `Logger`,
  `AppConfig` for `Config<typeof AppConfig>`, `ClaimQuota.caller` for
  `Port<typeof ClaimQuota>` — so an empty list is filled in by `--fix`. A
  type the rule does not know is accepted as written. The check is
  syntactic, so the level is `warn`; the guarantee is the compiler, which
  rejects a list that does not match.
