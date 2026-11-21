#!/usr/bin/env bash
# run-diag.sh <out-prefix> <n> [script] : shard scripts/saves-diag.ts over 14 processes
set -u
prefix="$1"; n="$2"; script="${3:-scripts/saves-diag.ts}"
cd "$(dirname "$0")/.."
rm -f "${prefix}"-*.jsonl
for ((i = 0; i < 14; i++)); do
  MODE=run N="$n" SHARD="$i" SHARDS=14 OUT="${prefix}-${i}.jsonl" node --import tsx "$script" > "${prefix}-${i}.log" 2>&1 &
done
wait
MODE=report PREFIX="$prefix" node --import tsx "$script"
