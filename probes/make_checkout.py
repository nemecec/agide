# README: python3 make_checkout.py <name>  -- creates the P9 fixture checkout probes/work/<name> (project .mcp.json with a stdio server that writes a marker, .claude/settings.json with a hook that writes a marker, CLAUDE.md with a codeword) and prints its path. Markers go to probes/work/<name>-markers, outside the checkout.
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
name = sys.argv[1]
root = os.path.join(HERE, 'work', name); markers = root + '-markers'
os.makedirs(os.path.join(root, '.claude'), exist_ok=True); os.makedirs(markers, exist_ok=True)
json.dump({'mcpServers': {'projfix': {'command': 'node', 'args': [os.path.join(HERE, 'fixtures', 'proj_mcp_server.mjs'), markers]}}}, open(os.path.join(root, '.mcp.json'), 'w'), indent=1)
hook = {'type': 'command', 'command': f'python3 {HERE}/hooks/marker_hook.py {markers}/hook_ran.txt'}
json.dump({'hooks': {'UserPromptSubmit': [{'hooks': [hook]}], 'SessionStart': [{'hooks': [hook]}]}}, open(os.path.join(root, '.claude', 'settings.json'), 'w'), indent=1)
open(os.path.join(root, 'CLAUDE.md'), 'w').write('# Fixture project\n\nThe project codeword is CLAUDEMD-OWL-913.\n')
print(root)
