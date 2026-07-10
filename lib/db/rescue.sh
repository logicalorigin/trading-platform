#!/usr/bin/env bash
# One-shot launcher for the DB rescue loop (see __rescue.mts).
cd /home/runner/workspace/lib/db || exit 1
APIPID=$(pgrep -f 'enable-source-maps.*dist/index.mjs' | head -1)
DBURL=$(tr '\0' '\n' < "/proc/$APIPID/environ" | grep -m1 '^DATABASE_URL=' | cut -d= -f2-)
if [ -z "$DBURL" ]; then echo "could not read DATABASE_URL from api process"; exit 1; fi
DATABASE_URL="$DBURL" nohup npx tsx __rescue.mts > /tmp/rescue.log 2>&1 &
echo "rescue armed (PID $!) — log: /tmp/rescue.log"
