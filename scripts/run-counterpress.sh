#!/usr/bin/env bash
# scripts/run-counterpress.sh: run scripts/counterpress-batch.ts in parallel shards.
#   scripts/run-counterpress.sh <out-prefix> <pairs> [shards]
# Aggregate with: REPORT=<out-prefix> npx tsx scripts/counterpress-batch.ts
set -u
prefix="$1"; n="$2"; shards="${3:-8}"
rm -f "${prefix}"-*.jsonl
for ((i = 0; i < shards; i++)); do
  N="$n" SHARD="$i" SHARDS="$shards" OUT="${prefix}-${i}.jsonl" \
    node --import tsx scripts/counterpress-batch.ts > /dev/null 2>&1 &
done
wait
