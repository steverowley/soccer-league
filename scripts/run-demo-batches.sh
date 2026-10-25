#!/usr/bin/env bash
# scripts/run-demo-batches.sh <dir>: every batch the demo artifacts need.
set -u
d="$1"; mkdir -p "$d"
bash scripts/run-batch.sh "$d/cal" std 80 '' 14
bash scripts/run-batch.sh "$d/str" str 40 '' 14
bash scripts/run-batch.sh "$d/swap" swap 200 '' 14
for f in imprecision utilitySoftness personality confidence momentum scoreClockTerm homeAdvantage; do
  bash scripts/run-batch.sh "$d/off-$f" std 40 "$f" 14
done
echo done
