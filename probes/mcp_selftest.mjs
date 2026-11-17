// README: node mcp_selftest.mjs  -- exercises mcp_host.mjs with plain fetch (auth, Origin, tools) without claude.
import { startMcpHost } from './mcp_host.mjs';
const h = await startMcpHost();
const post = (body, headers = {}) => fetch(h.url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers }, body: JSON.stringify(body) });
const auth = { authorization: `Bearer ${h.token}` };
console.log('no token', (await post({ jsonrpc: '2.0', id: 1, method: 'ping' })).status);
console.log('bad token', (await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { authorization: 'Bearer x' })).status);
console.log('origin', (await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { ...auth, origin: 'http://evil.example' })).status);
const i = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } }, auth);
console.log('init', i.status, i.headers.get('mcp-session-id') ? 'sid' : 'nosid', JSON.stringify(await i.json()).slice(0, 120));
console.log('tools', (await (await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, auth)).json()).result.tools.map((t) => t.name));
console.log('call', JSON.stringify(await (await post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'ui_create_folder', arguments: { name: 'A' } } }, auth)).json()));
console.log('call err', JSON.stringify(await (await post({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'ui_move_session', arguments: { session_id: 'zz', folder_id: 'root' } } }, auth)).json()));
await h.close();
