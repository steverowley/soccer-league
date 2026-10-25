#!/usr/bin/env bash
# scripts/run-pair.sh: run two batches (two checkouts) concurrently and wait.
#   scripts/run-pair.sh <dirA> <prefixA> <dirB> <prefixB> <mode> <n> [shards-each]
set -u
sh="${7:-8}"
(cd "$1" && bash scripts/run-batch.sh "$2" "$5" "$6" '' "$sh") &
(cd "$3" && bash scripts/run-batch.sh "$4" "$5" "$6" '' "$sh") &
wait
