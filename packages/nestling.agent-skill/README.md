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
`SKILL.md`, fourteen `references/` files and the manifest
`.manifest.json`. Another directory is set by `--dir <path>`.

The manifest is what makes a repeated install tell an edited file from a
merely old one. It carries the version of the package and the hash of
every file the command laid down, so:

- a missing file is created;
- a file whose hash the manifest recognises is replaced by the new version
  silently — that is the ordinary upgrade;
- a file whose hash the manifest does not recognise is named, left as it
  is, and the command finishes with exit code 1, because a user's edits
  are not silently lost; `--force` overwrites it.

A copy installed by an earlier version of the command has no manifest.
There is nothing to compare against, so every file is compared with the
source, and one `--force` is the price of the first upgrade. After it the
manifest is there and upgrades go silently.

## Minimal example

```typescript
import { installSkill } from '@nestlingjs/agent-skill';

const report = await installSkill({ dir: './apps/api', force: false });

console.log(report.created.length, report.updated.length);

if (report.diverged.length > 0) {
  console.log(`diverged: ${report.diverged.join(', ')}`);
}
```

## Exports

| Name | What it does |
|---|---|
| `installSkill` | puts the skill files into `.claude/skills/nestling/` inside the project directory, writes the manifest and returns the report as a value |
| `InstallOptions` | install options: the project directory and the permission to overwrite diverged files |
| `InstallReport` | the report: the destination directory, the version, and the created, updated, matched and diverged files |
| `SkillManifest` | what the manifest holds: the version of the package and the hash of every file by its path |
| `SKILL_PATH` | the path of the skill inside the project — `.claude/skills/nestling` |
| `MANIFEST_NAME` | the name of the manifest inside that directory — `.manifest.json` |

The `nestling-agent-skill` command is the same install from the terminal.
It is what `npx @nestlingjs/agent-skill` runs: the package has one
command, and there is no need to name it.

## Package boundaries

The package carries text and copies files. There is no framework code in
it: `dist` depends on nothing but Node modules. The skill describes only
writing an application on Nestling; work on the framework itself is
carried by the skills of the repository.

The manifest is written by the command into the project, and does not
travel in the tarball: the version would otherwise live in three places
and drift apart from the other two.

The snippets of the skill live in `snippets/` as compiled files and do
not travel into the tarball: they exist so that `yarn verify` fails the
skill that diverges from the API. The code blocks are checked by
`scripts/snippets.mjs`, and rewritten by
`yarn workspace @nestlingjs/agent-skill snippets`. A block may show a
named region of a file rather than the whole of it: `<!-- snippet:
file.ts#region -->` next to `// #region region` and `// #endregion` in the
file. The fence of a block always names its language — dropping the
language would be a way around the check.

The text of the skill is held by two more checks, in `scripts/freshness.mjs`
and `src/skill.spec.ts`: the version named in `SKILL.md` matches
`package.json`, a name removed by a release does not appear in the text,
the table of packages names every published package, and the table of
phases has no gap.

The snippets are checked by more than compilation. The ones that
`snippets/app.ts` reaches by imports are built into an application by
the spec through `buildTest`: the root policy, the endpoint layer, the
edge between features and the provider of the layer step are caught the
same way as for a user.
