#!/bin/sh
# README: hook command for the container probe: appends the payload (one JSON object) to $FAKE_EVENTS_DIR/hooks.jsonl, with a newline.
{ cat; echo; } >> "${FAKE_EVENTS_DIR:-/events}/hooks.jsonl"
