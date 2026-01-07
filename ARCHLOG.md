[07.01.2026] Handler classes instead of Controllers.

Switched from @Controller with @Endpoint methods to @Handler on classes. Main reasons:
1. TypeScript method decorators cannot check parameter types against schemas due to type system limitations
2. @Handler on class constructors allows checking the entire class shape through constructor constraint
3. One class = one endpoint (Single Responsibility) - better isolation and testability
4. Both functional style (app.registerHandler) and class style (@Handler) provide full type checking

Controller approach (multiple endpoints in one class) violates SRP and lacks compile-time type safety. Handler approach is more explicit and type-safe.

[27.09.2025] Modules as plain objects.

Modules make dependency tree much more complex if they are class with dependencies. My take is that modules are just blueprints, that shouldn't work in application runtime. No lifecycle hooks, no injection, etc.

There are some doubts though:
1. Maybe we'll need hooks that should work when all module providers are initialized or destroyed. We always have option to extend configuration object and `makeModule` function
2. Maybe we'll need something like `configure` function which can be used by plugins to extends app functionality. But this doesn't seem to be ID-container's business.

Module metadata will be preserved. We will always know what module is source of any provider.

One thing that i had in my mind - remove modules from container and make them next layer of abstraction. But in this case we won't be able to protect module scopes (everything will be global!)