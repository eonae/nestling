#!/usr/bin/env bash
#
# Драйвер автономного прогона openspec-change'ей.
#
# Каждый шаг — отдельный процесс `claude -p`, то есть свежий контекст по
# построению. Внутри одного change'а apply вызывается в цикле: он идемпотентен
# и продолжает с незакрытых чекбоксов tasks.md, поэтому L-размер доезжает
# за несколько раундов без участия человека.
#
# Использование:
#   scripts/run-changes.sh scripts/waves/wave-1.manifest
#   scripts/run-changes.sh --dry-run scripts/waves/wave-1.manifest
#
# Формат манифеста: строки `имя|описание для propose`, пустые и `#` — игнор.
#
# Переменные окружения:
#   MAX_APPLY_ROUNDS  потолок раундов apply на один change (по умолчанию 8)
#   STALL_TOLERANCE   сколько незакрытых задач при застое отдаём архивации (2)
#   PERMISSION_MODE   режим прав для claude -p (по умолчанию auto)
#   SKIP_ARCHIVE      1 — не архивировать (оставить change'и открытыми)
#
# Скрипт НЕ пушит и НЕ переключает ветки: запускай его из той папки/worktree,
# где хочешь получить коммиты.

set -uo pipefail

MAX_APPLY_ROUNDS=${MAX_APPLY_ROUNDS:-8}
STALL_TOLERANCE=${STALL_TOLERANCE:-2}
PERMISSION_MODE=${PERMISSION_MODE:-auto}
SKIP_ARCHIVE=${SKIP_ARCHIVE:-0}
DRY_RUN=0

[[ ${1:-} == "--dry-run" ]] && { DRY_RUN=1; shift; }

MANIFEST=${1:-}
[[ -z $MANIFEST || ! -f $MANIFEST ]] && {
  echo "Использование: $0 [--dry-run] <манифест>" >&2
  exit 2
}

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || {
  echo "Не git-репозиторий" >&2
  exit 2
}
cd "$REPO_ROOT" || exit 2

RUN_ID=$(date +%Y%m%d-%H%M%S)
LOG_DIR="$REPO_ROOT/.openspec-runs/$RUN_ID"
mkdir -p "$LOG_DIR"

log()  { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[33m! %s\033[0m\n' "$*"; }
die()  {
  printf '\033[31m✗ %s\033[0m\n' "$*"
  echo "Логи: $LOG_DIR"
  echo "Возобновить с места остановки (propose пропустится, apply продолжит с незакрытых чекбоксов):"
  echo "  ALLOW_DIRTY=1 $0 $MANIFEST"
  exit 1
}

# --- preflight ---------------------------------------------------------------

for bin in claude openspec jq yarn; do
  command -v "$bin" >/dev/null || die "не найден $bin"
done

if (( ! DRY_RUN )) && [[ ${ALLOW_DIRTY:-0} != 1 ]] && [[ -n $(git status --porcelain) ]]; then
  die "рабочее дерево грязное — закоммить, спрячь изменения, или запусти с ALLOW_DIRTY=1 для возобновления"
fi

BRANCH=$(git branch --show-current)
log "прогон $RUN_ID · ветка $BRANCH · логи $LOG_DIR"

# --- helpers -----------------------------------------------------------------

# Трим пробелов средствами bash. НЕ через `xargs`: он трактует апострофы
# в описаниях («endpoint'а») как открывающую кавычку и падает.
trim() {
  local s=$1
  s=${s#"${s%%[![:space:]]*}"}
  s=${s%"${s##*[![:space:]]}"}
  printf '%s' "$s"
}

change_known() { openspec list --json | jq -e --arg c "$1" '[.changes[]|select(.name==$c)]|length>0' >/dev/null 2>&1; }

# Заархивированный change исчезает из `openspec list`, поэтому без этой проверки
# драйвер счёл бы его несуществующим и предложил заново — на повторном прогоне
# манифеста это означало бы propose поверх уже сделанной работы.
change_archived() { compgen -G "openspec/changes/archive/*-$1" >/dev/null 2>&1; }
tasks_total()  { openspec list --json | jq -r --arg c "$1" '[.changes[]|select(.name==$c)]|first|.totalTasks     // 0' 2>/dev/null; }
tasks_done()   { openspec list --json | jq -r --arg c "$1" '[.changes[]|select(.name==$c)]|first|.completedTasks // 0' 2>/dev/null; }

claude_step() { # <лог-файл> <промпт>
  local logfile=$1 prompt=$2
  if (( DRY_RUN )); then
    echo "  [dry-run] claude -p '${prompt}' --permission-mode $PERMISSION_MODE"
    return 0
  fi
  claude -p "$prompt" --permission-mode "$PERMISSION_MODE" >>"$logfile" 2>&1
}

gate() { # <лог-файл>
  local logfile=$1
  (( DRY_RUN )) && { echo "  [dry-run] yarn verify && yarn docs:audit"; return 0; }
  yarn verify >>"$logfile" 2>&1 || return 1
  yarn docs:audit >>"$logfile" 2>&1 || return 1
}

# --- основной цикл -----------------------------------------------------------

while IFS='|' read -r name description; do
  name=$(trim "${name:-}")
  [[ -z $name || $name == \#* ]] && continue
  description=$(trim "${description:-}")

  LOGFILE="$LOG_DIR/$name.log"
  HEAD_BEFORE=$(git rev-parse HEAD)
  log "change: $name"

  if change_archived "$name"; then
    printf '\033[32m✓ %s — уже в архиве, пропуск\033[0m\n' "$name"
    continue
  fi

  # 1. propose — только если change'а ещё нет
  if change_known "$name"; then
    echo "  артефакты на месте, propose пропущен"
  else
    [[ -z $description ]] && die "$name: нет артефактов и нет описания для propose"
    echo "  propose…"
    claude_step "$LOGFILE" "/opsx:propose \"$name: $description\"" \
      || die "$name: propose упал (см. $LOGFILE)"
    (( DRY_RUN )) || change_known "$name" \
      || die "$name: propose отработал, но change не появился в openspec list"
  fi

  # 2. apply — раундами, пока не закроются все чекбоксы
  round=0
  prev_done=-1
  while : ; do
    (( DRY_RUN )) && { echo "  [dry-run] apply-цикл"; break; }

    total=$(tasks_total "$name"); done_n=$(tasks_done "$name")
    [[ $total -gt 0 && $done_n -eq $total ]] && { echo "  задачи закрыты ($done_n/$total)"; break; }

    (( round++ ))
    (( round > MAX_APPLY_ROUNDS )) && die "$name: исчерпан лимит раундов ($MAX_APPLY_ROUNDS) на $done_n/$total"

    # Часть задач по своему тексту выполняется шагом archive («абзац в archlog
    # на этапе archive», «статус в roadmap после archive»). Требовать 100%
    # до архивации — дедлок: задача не закроется без archive, а archive
    # не запустится без задачи. Поэтому застой с маленьким остатком отдаём
    # архивации, а не считаем провалом; большой остаток — по-прежнему стоп.
    if (( done_n == prev_done && round > 1 )); then
      local_remaining=$(( total - done_n ))
      if (( local_remaining <= STALL_TOLERANCE )); then
        warn "$name: застой на $done_n/$total, остаток $local_remaining — отдаём архивации"
        break
      fi
      die "$name: раунд без прогресса ($done_n/$total) — застряло, см. $LOGFILE"
    fi
    prev_done=$done_n

    echo "  apply, раунд $round ($done_n/$total)…"
    claude_step "$LOGFILE" "/opsx:apply $name" \
      || die "$name: apply упал на раунде $round (см. $LOGFILE)"
  done

  # 3. гейт — красный останавливает конвейер, чтобы поломка не поехала дальше
  echo "  verify + docs:audit…"
  gate "$LOGFILE" || die "$name: гейт красный (см. $LOGFILE)"

  # 4. archive
  if [[ $SKIP_ARCHIVE == 1 ]]; then
    echo "  archive пропущен (SKIP_ARCHIVE=1)"
  else
    echo "  archive…"
    claude_step "$LOGFILE" "/opsx:archive $name" || die "$name: archive упал (см. $LOGFILE)"
  fi

  # 5. коммит — точка отката перед следующим change'ем.
  # Сессии apply/archive обычно коммитят сами и осмысленнее, чем шаблон ниже;
  # драйвер добирает только то, что осталось в дереве.
  if (( DRY_RUN )); then
    echo "  [dry-run] git commit"
  elif [[ $HEAD_BEFORE != $(git rev-parse HEAD) && -z $(git status --porcelain) ]]; then
    echo "  закоммичено сессиями change'а: $(git rev-list --count "$HEAD_BEFORE"..HEAD) коммит(ов)"
  elif [[ -n $(git status --porcelain) ]]; then
    git add -A && git commit -q -m "feat($name): реализация change $name" \
      -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>" \
      || die "$name: коммит не прошёл"
    echo "  закоммичено: $(git rev-parse --short HEAD)"
  else
    warn "$name: change не оставил ни коммитов, ни изменений в дереве — проверь $LOGFILE"
  fi

  printf '\033[32m✓ %s готов\033[0m\n' "$name"
done < "$MANIFEST"

log "прогон завершён. Логи: $LOG_DIR"
