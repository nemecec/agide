// README: node elicit_mcp_server.mjs <logfile>  -- stdio MCP server for P15 (no dependencies). One tool, ask_color, sends an elicitation/create request to the client (form mode, one enum field) and returns the client's answer as text. Logs the client's declared capabilities, the elicitation request and the response to <logfile> as JSON lines.
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
const logFile = process.argv[2];
const log = (o) => { if (logFile) appendFileSync(logFile, JSON.stringify({ t: Date.now(), ...o }) + '\n'); };
const send = (o) => process.stdout.write(JSON.stringify(o) + '\n');
let nextId = 1000; const pending = new Map(); let clientCaps = null;
const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m.id !== undefined && !m.method) { const p = pending.get(m.id); if (p) { pending.delete(m.id); log({ kind: 'elicitation-response', response: m }); p(m); } return; }
  if (m.method === 'initialize') {
    clientCaps = m.params?.capabilities; log({ kind: 'initialize', clientCapabilities: clientCaps, clientInfo: m.params?.clientInfo, protocolVersion: m.params?.protocolVersion });
    send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'elicit-probe', version: '0.0.1' } } });
  } else if (m.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'ask_color', description: 'Asks the user for a favourite colour through an MCP elicitation request and returns the answer.', inputSchema: { type: 'object', properties: {} } }] } });
  } else if (m.method === 'tools/call') {
    const id = nextId++;
    const req = { jsonrpc: '2.0', id, method: 'elicitation/create', params: { message: 'Pick a colour for the probe', requestedSchema: { type: 'object', properties: { color: { type: 'string', title: 'Colour', enum: ['red', 'green', 'blue'] } }, required: ['color'] } } };
    log({ kind: 'elicitation-request', request: req });
    pending.set(id, (resp) => send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'elicitation answer: ' + JSON.stringify(resp.result ?? resp.error) }] } }));
    send(req);
  } else if (m.id !== undefined) send({ jsonrpc: '2.0', id: m.id, result: {} });
});
