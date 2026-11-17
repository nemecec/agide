# README: Elicitation hook that answers an MCP elicitation. Usage in settings: python3 elicit_answer.py <logfile>. Logs the stdin payload and prints hookSpecificOutput with action accept and content {"color": "green"}.
import sys, json
raw = sys.stdin.read()
with open(sys.argv[1], 'a') as f: f.write(raw.strip() + '\n')
print(json.dumps({'hookSpecificOutput': {'hookEventName': 'Elicitation', 'action': 'accept', 'content': {'color': 'green'}}}))
