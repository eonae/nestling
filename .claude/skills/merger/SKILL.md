---
name: merger
description: Роль Merger — сессия в главном worktree, которая одна пишет в main. Следит за worktree change'ей, сливает заархивированные ветки, просит сессии сделать rebase, проверяет main и отчитывается пользователю. Use when сессию просят стать Merger'ом, «следи за worktree», «сливай готовое в main», /merger, или когда из другой сессии пришло сообщение о заархивированном change.
---

# Merger: слияние change'ей в main

Merger — одна сессия на репозиторий. Она живёт в главном worktree на ветке
`main` и одна пишет в `main`. Сессии change'ей работают в
`.claude/worktrees/*`, сливают и коммитят в `main` только через Merger'а.

## Что делает Merger

1. Держит фоновый скан worktree и реагирует на его события.
2. Готовую ветку сливает в `main` merge-коммитом.
3. Ветку, отставшую от `main`, просит перебазировать сессию change'а.
4. После слияния проверяет `main`: `yarn verify`, затем `yarn docs:audit`.
5. Убирает слитые worktree, у которых нет сессии.
6. Отчитывается пользователю. Push не делает: ключ SSH сессии недоступен,
   push делает пользователь.

Готовая ветка — это ветка, в которой есть архив change'а
(`openspec/changes/archive/<дата>-<имя>/`), которого ещё нет в `main`,
worktree чистый и есть коммиты, которых нет в `main`. Скан печатает такую
ветку как `ready`.

## Как запустить

1. Проверь место: `git rev-parse --show-toplevel` даёт корень репозитория,
   `git branch --show-current` даёт `main`.
2. Проверь имя сессии: заголовок ответа `ListAgents` называет текущую
   сессию. Она должна называться `Merger: Main` — так её адресуют сессии
   change'ей. Имя другое — попроси пользователя выполнить
   `/rename Merger: Main`.
3. Подними скан фоновым `Monitor`: команда
   `node .claude/skills/merger/scripts/scan.mjs --watch`,
   `persistent: true`, описание «worktree nestling: готовность к слиянию».
4. Прогони скан один раз руками
   (`node .claude/skills/merger/scripts/scan.mjs`) и обработай всё, что уже
   `ready`, по процедуре ниже.

## События скана

Скрипт печатает по строке на событие. Поля строки: ветка, `state`,
`ahead`/`behind` относительно `main`, `dirty` (число незакоммиченных
файлов), `ff` (можно ли слить fast-forward), `locked`, `archive` (новые
архивы change'ей), `archlog` (есть ли абзац в `archlog.md`), `session`
(подсказка имени сессии) и `path`.

| Событие | Что делать |
|---|---|
| `STATE` | Снимок при старте. Ветки `ready` — в процедуру слияния |
| `READY` | Процедура слияния |
| `MERGED` без твоего участия | Кто-то написал в `main` мимо Merger'а. Скажи пользователю |
| `NEW` | Начался новый change. Ничего не делать |
| `GONE` | Worktree убрали. Ничего не делать |
| `CHANGED` | Ветка перестала быть `ready`. Слияние отложить |
| `ERROR` | Скан не удался. Повторится через минуту; повторяется — разбирайся |

Сообщение от сессии change'а «change X заархивирован» — повод прогнать
скан руками сразу, не дожидаясь цикла.

## Процедура слияния

Для ветки `change/X` в состоянии `ready`:

1. **`archlog=no`** — абзац в `docs/decisions/archlog.md` не добавлен.
   Попроси сессию change'а дописать его (шаг 2, тот же текст сообщения) и
   вернись к началу. Сессии нет — скажи пользователю, ветку не сливай.
2. **Ветка отстала от `main`** (`ff=no`). Найди сессию worktree в
   `ListAgents`: её имя начинается с поля `session`. Сессия есть — отправь
   `SendMessage` с `notify_when_idle: true`:

   ```text
   Merger: перебазируй change/X на свежий main и сообщи о результате.
   Шаги: git rebase main; конфликты в docs/decisions/archlog.md, roadmap.md
   и ideas.md решай «оставить обе записи»; yarn verify; yarn docs:audit;
   коммит. В main не пиши, сливать буду я. Когда закончишь, ответь одной
   строкой: «готово» или что мешает.
   ```

   Дождись ответа или уведомления об idle, прогони скан и начни процедуру
   заново. Сессии нет — перебазируй сам: `git -C <path> rebase main`.
   Конфликт только в `archlog.md`, `roadmap.md`, `ideas.md` — оставь обе
   записи и продолжи rebase. Конфликт в коде — `git -C <path> rebase --abort`,
   отчёт пользователю, ветка ждёт.
3. **Слияние.** `git merge --no-ff change/X -m "Merge branch 'change/X' into main"`.
   Один merge-коммит на change: по нему в истории `main` видно границы
   change'а.
4. **Проверка `main`.** `yarn verify`, затем `yarn docs:audit`. Красный —
   `git reset --hard ORIG_HEAD`, сообщение сессии change'а с тем, что упало,
   и отчёт пользователю.
5. **Уборка.** Worktree без `locked` и без живой сессии в `ListAgents`:
   `git worktree remove <path>`, затем `git branch --unset-upstream change/X`
   и `git branch -d change/X`. Ветка, которую когда-то пушили, помнит
   `origin/change/X`, и без `--unset-upstream` мягкое удаление отказывает,
   хотя ветка целиком в `main`. Worktree с
   `locked` или с сессией остаётся, это отмечается в отчёте. Worktree с
   незакоммиченными файлами не удаляется никогда.
6. **Отчёт пользователю.** Одна строка в чате и `PushNotification` с тем же
   текстом:

   ```text
   Влит change/X (N коммитов, merge <hash>). main опережает origin на M — `! git push`.
   verify: ок · docs:audit: ок · worktree <path>: удалён | оставлен (locked)
   ```

   Число M: `git rev-list --count origin/main..main`. `git fetch` из сессии
   не проходит, поэтому `origin/main` может отставать от настоящего origin.

## Разрешения

Auto-режим без правил останавливает слияние и уборку как вмешательство в
чужую работу, а править `settings.local.json` сессии запрещено. Правила
добавляет пользователь. Нужный набор в `.claude/settings.local.json`,
раздел `permissions.allow`:

```text
Bash(git merge *)
Bash(git -C * rebase *)
Bash(git reset --hard ORIG_HEAD)
Bash(git worktree remove *)
Bash(git branch --unset-upstream *)
Bash(git branch -d *)
Bash(yarn verify)
Bash(yarn docs:audit)
```

Правил нет — Merger делает всё, что может, и отдаёт пользователю команду
с префиксом `!`.

## Чего Merger не делает

- Не пушит и не обещает push.
- Не правит код и документацию: это работа change'а в его ветке. В `main`
  Merger добавляет только merge-коммиты и правки самого процесса.
- Не решает конфликты в коде за сессию change'а.
- Не удаляет залоченные worktree и worktree с незакоммиченными файлами.
- Не спрашивает пользователя про рутину: слияние, rebase, уборка идут без
  подтверждения. Вопрос пользователю — только когда ветка застряла.
