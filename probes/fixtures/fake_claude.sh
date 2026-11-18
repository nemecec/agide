#!/bin/sh
# README: stand-in for claude on busybox (alpine) for the container probe. Environment: FAKE_EVENTS_DIR (hook files and pid file), FAKE_HOOK_CMD (shell command run for each event with the payload on stdin, like a settings hook), FAKE_SESSION_ID, MCP_URL and MCP_TOKEN (host MCP endpoint). Typed lines: /exit, /mcp (initialize over HTTP with the bearer token), /who (user, config dir owner), anything else is echoed and ends a turn with the Stop event. A resize prints size=<cols>x<rows>; Ctrl-C prints interrupted; SIGTERM and SIGHUP run SessionEnd.
EVENTS="${FAKE_EVENTS_DIR:-/events}"
SID="${FAKE_SESSION_ID:-s0}"
echo $$ > "$EVENTS/pid"
hook() { printf '{"session_id":"%s","hook_event_name":"%s"%s}' "$SID" "$1" "${2:+,$2}" | sh -c "$FAKE_HOOK_CMD"; }
size() { printf 'size=%s\r\n' "$(stty size | awk '{print $2"x"$1}')"; }
trap 'GOT_INT=1; size' WINCH
trap 'GOT_INT=1; printf "interrupted\r\n> "' INT
trap 'hook SessionEnd; exit 143' TERM
trap 'hook SessionEnd; exit 129' HUP
printf 'fake-claude ready '; size; printf '> '
hook SessionStart '"source":"startup"'
while true; do
  IFS= read -r line || { [ -n "$GOT_INT" ] && { GOT_INT=; continue; }; break; }
  line=$(printf '%s' "$line" | tr -d '\r')
  case "$line" in
    /exit) hook SessionEnd; exit 0 ;;
    /who) printf 'uid=%s config=%s owner=%s\r\n> ' "$(id -u)" "$CLAUDE_CONFIG_DIR" "$(stat -c %u "$CLAUDE_CONFIG_DIR" 2>/dev/null)" ;;
    /mcp)
      H="Authorization: Bearer $MCP_TOKEN"
      r1=$(wget -q -T 5 -O - --header "$H" --header 'Content-Type: application/json' --header 'Accept: application/json, text/event-stream' --post-data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"fake","version":"0"}}}' "$MCP_URL" 2>&1 | head -c 120)
      printf 'mcp-initialize: %s\r\n> ' "$r1" ;;
    *) hook UserPromptSubmit "\"prompt\":\"$line\""; printf 'echo: %s\r\n' "$line"; hook Stop "\"last_assistant_message\":\"echo: $line\""; printf '> ' ;;
  esac
done
