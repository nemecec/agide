#!/bin/sh
# README: wrapper that runs claude under the sandbox runtime. Needs SRT_BIN and SRT_SETTINGS in the environment; used by p16_srt.py through CLAUDE_BIN.
exec "$SRT_BIN" -s "$SRT_SETTINGS" -- claude "$@"
