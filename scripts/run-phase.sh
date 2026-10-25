#!/usr/bin/env bash
# scripts/run-phase.sh: run scripts/phase-metrics.ts in parallel shards, then report.
#   scripts/run-phase.sh <out-prefix> <std|isl> <n> [shards] [pairs] [off-flags]
set -u
prefix="$1"; mode="$2"; n="$3"; shards="${4:-14}"; pairs="${5:-}"; off="${6:-}"
rm -f "${prefix}"-*.jsonl
for ((i = 0; i < shards; i++)); do
  MODE="$mode" N="$n" SHARD="$i" SHARDS="$shards" PAIRS="$pairs" OFF="$off" OUT="${prefix}-${i}.jsonl" \
    node --import tsx scripts/phase-metrics.ts > /dev/null 2>&1 &
done
wait
REPORT="$prefix" node --import tsx scripts/phase-metrics.ts
