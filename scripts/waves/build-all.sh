#!/usr/bin/env bash
# Пересобирает all-waves.manifest из манифестов отдельных волн.
set -euo pipefail
cd "$(dirname "$0")"

{
  echo "# ВСЕ ВОЛНЫ подряд — сгенерировано из scripts/waves/wave-{1..6}.manifest."
  echo "# Правь исходные манифесты волн, затем пересобери:"
  echo "#   scripts/waves/build-all.sh"
  echo
  for w in 1 2 3 4 5 6; do
    echo "# ─────────── ВОЛНА $w ───────────"
    cat "wave-$w.manifest"
    echo
  done
} > all-waves.manifest

echo "all-waves.manifest: $(grep -vc '^\s*#\|^\s*$' all-waves.manifest) change'ей"
