# @nestlingjs/agent-skill

A Claude Code skill about Nestling, and the command that puts it into a
project. The skill gives the agent the shape of the code and the rules
that cannot be derived from NestJS practice: declarations as values, an
explicit dependency list, failures as values, calling a neighbouring
feature by an operation.

> 🚧 Active development, the API may change. The text of the skill is
> English: it is read by the model, not by the developer.
> Design: [`docs/en/design/principles.md`](../../docs/en/design/principles.md).
> Guide: [table of contents](../../docs/en/guide/README.md).

## Install

```bash
npx @nestlingjs/agent-skill
```

The command writes `.claude/skills/nestling/` in the current directory:
`SKILL.md` and eleven `references/` files. Another directory is set by
`--dir <path>`.

A missing file is created by the command. A file that matches the source
is left untouched. A file that differs is named and the command finishes
with exit code 1, because a user's edits are not silently lost; `--force`
overwrites it.

## Minimal example

```typescript
import { installSkill } from '@nestlingjs/agent-skill';

const report = await installSkill({ dir: './apps/api', force: false });

console.log(report.created.length, report.unchanged.length);

if (report.diverged.length > 0) {
  console.log(`diverged: ${report.diverged.join(', ')}`);
}
```

## Exports

| Name | What it does |
|---|---|
| `installSkill` | puts the skill files into `.claude/skills/nestling/` inside the project directory and returns the report as a value |
| `InstallOptions` | install options: the project directory and the permission to overwrite diverged files |
| `InstallReport` | the report: the destination directory, the created, matched and diverged files |
| `SKILL_PATH` | the path of the skill inside the project — `.claude/skills/nestling` |

The `nestling-agent-skill` command is the same install from the terminal.
It is what `npx @nestlingjs/agent-skill` runs: the package has one
command, and there is no need to name it.

## Package boundaries

The package carries text and copies files. There is no framework code in
it: `dist` depends on nothing but Node modules. The skill describes only
writing an application on Nestling; work on the framework itself is
carried by the skills of the repository.

The snippets of the skill live in `snippets/` as compiled files and do
not travel into the tarball: they exist so that `yarn verify` fails the
skill that diverges from the API. The code blocks are checked by
`scripts/snippets.mjs`, and rewritten by
`yarn workspace @nestlingjs/agent-skill snippets`.

The snippets are checked by more than compilation. The ones that
`snippets/app.ts` reaches by imports are assembled into an application by
the spec through `assembleTest`: the root policy, the endpoint layer, the
edge between features and the provider of the layer unit are caught the
same way as for a user.
