#!/usr/bin/env bash
# scripts/run-batch.sh: run scripts/batch-json.ts in parallel shards and wait.
#   scripts/run-batch.sh <out-prefix> <mode> <n> [off-flags] [shards]
# Writes <out-prefix>-<shard>.jsonl; aggregate with scripts/batch-report.ts.
set -u
prefix="$1"; mode="$2"; n="$3"; off="${4:-}"; shards="${5:-14}"
rm -f "${prefix}"-*.jsonl
for ((i = 0; i < shards; i++)); do
  MODE="$mode" N="$n" SHARD="$i" SHARDS="$shards" OFF="$off" OUT="${prefix}-${i}.jsonl" \
    node --import tsx scripts/batch-json.ts > /dev/null 2>&1 &
done
wait
