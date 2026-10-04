#!/usr/bin/env bash
# Run a command; on failure, surface the tail of its output as a GitHub annotation
# (readable through the checks API without downloading raw logs).
set -o pipefail
name="$1"; shift
log="$(mktemp)"
"$@" 2>&1 | tee "$log"
code=${PIPESTATUS[0]}
if [ "$code" -ne 0 ]; then
  tail -n 120 "$log" | grep -v '^\s*$' | tail -n 100 > "$log.tail"
  msg="$(sed -e 's/%/%25/g' "$log.tail" | awk '{printf "%s%%0A", $0}')"
  echo "::error title=${name} failed::${msg}"
fi
exit "$code"
