# Места под `isolatedDeclarations`

Пересчёт по всем пакетам, а не по пяти из замера. Снято на коммите части A
командой вида `tsc -p <пакет>/tsconfig.build.json --isolatedDeclarations
--emitDeclarationOnly`.

## Пакеты, которые выпускают декларации

| пакет | мест | чем именно |
| --- | --- | --- |
| `nestling.app` | 31 | `TS9010`×22, `TS9013`×7, `TS9023`×2 |
| `nestling.operations` | 8 | `TS9010`×7, `TS9018`×1 |
| `nestling.transport.http` | 7 | `TS9010`×6, `TS9038`×1 |
| `nestling.mcp` | 6 | `TS9010`×6 |
| `nestling.outbox` | 6 | `TS9010`×6 |
| `common.static-server` | 5 | `TS9013`×5 |
| `nestling.schema.zod` | 4 | `TS9007`×4 |
| `nestling.drizzle.pg` | 3 | `TS9007`×2, `TS9010`×1 |
| `nestling.eslint-plugin` | 3 | `TS9013`×3 |
| `nestling.inbox` | 3 | `TS9010`×3 |
| `nestling.subscriptions` | 3 | `TS9010`×3 |
| `nestling.transport.cli` | 2 | `TS9010`×2 |
| `nestling.transport.nats` | 2 | `TS9010`×2 |
| `nestling.agent-skill` | 1 | `TS9010`×1 |
| `nestling.container` | 1 | `TS9007`×1 |
| остальные девять | 0 | — |

Итого 85. Замер в дизайне обещал 49 по пяти пакетам и совпал по всем пяти,
кроме `app`: там было 33, стало 31 — два `TS9038` уже сняты швами `BuiltApp`.

Расшифровка кодов: `TS9007` — функция без типа возврата, `TS9010` —
переменная без аннотации, `TS9013` — выражение невыразимо, `TS9018` —
параметр с деструктуризацией, `TS9023` — свойство дописано функции,
`TS9038` — вычисляемое имя.

## Проекты, которые деклараций не выпускают

| проект | мест | чем собирается |
| --- | --- | --- |
| `examples/microservice` | 63 | esbuild |
| `examples/modular-app` | 40 | esbuild |
| `nestling.viz` | 31 | esbuild и vite |
| `examples/cli` | 9 | esbuild |

Здесь 143 места, и все они — работа впустую: `isolatedDeclarations`
ограничивает то, из чего выводится декларация, а этим проектам выводить
нечего. Поэтому каждый из них говорит об этом прямо — `declaration: false`,
— и флаг базы их не касается. Проверено: с этой строкой все 143 диагностики
уходят.
