[27.09.2025] Modules as plain objects.

Modules make dependency tree much more complex if they are class with dependencies. My take is that modules are just blueprints, that shouldn't work in application runtime. No lifecycle hooks, no injection, etc.

There are some doubts though:
1. Maybe we'll need hooks that should work when all module providers are initialized or destroyed. We always have option to extend configuration object and `makeModule` function
2. Maybe we'll need something like `configure` function which can be used by plugins to extends app functionality. But this doesn't seem to be ID-container's business.

Module metadata will be preserved. We will always know what module is source of any provider.

One thing that i had in my mind - remove modules from container and make them next layer of abstraction. But in this case we won't be able to protect module scopes (everything will be global!)