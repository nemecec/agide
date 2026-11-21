// README: shared helpers for the milestone 4 swarm probes P30 to P37 (Node ESM). Not run directly. Adds fresh directories under probes/work/, a request/response helper for control requests and a can_use_tool auto-answerer on top of lib.mjs.
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { startStream, userMsg, resultsOf, initOf, save, sleep, WORK } from './lib.mjs';

export { startStream, userMsg, resultsOf, initOf, save, sleep };
export const fresh = (prefix = 'p-m4-') => mkdtempSync(join(WORK, prefix));
export const cleanup = (d) => { try { rmSync(d, { recursive: true, force: true }); } catch {} };
export const dump = (name, h) => save(`${name}.jsonl`, h.events.map((e) => JSON.stringify(e)).join('\n'));

export const brief = (r) => r && ({
  subtype: r.subtype, is_error: r.is_error, result: String(r.result ?? '').slice(0, 160), session_id: r.session_id,
  cost: r.total_cost_usd, num_turns: r.num_turns, duration_ms: r.duration_ms, duration_api_ms: r.duration_api_ms,
  stop_reason: r.stop_reason, terminal_reason: r.terminal_reason, errors: r.errors,
  usage: r.usage && { in: r.usage.input_tokens, out: r.usage.output_tokens, cache_read: r.usage.cache_read_input_tokens, cache_create: r.usage.cache_creation_input_tokens },
  modelUsage: r.modelUsage && Object.fromEntries(Object.entries(r.modelUsage).map(([m, u]) => [m, { in: u.inputTokens, out: u.outputTokens, cost: u.costUSD }])),
});

// Sends a control_request and waits for the control_response with the same request_id.
let reqSeq = 0;
export async function control(h, request, ms = 20000) {
  const request_id = `probe-${++reqSeq}-${request.subtype}`;
  const t0 = Date.now();
  h.send({ type: 'control_request', request_id, request });
  const resp = await h.waitFor((e) => e.type === 'control_response' && e.response?.request_id === request_id, ms);
  return { request: request.subtype, ms: Date.now() - t0, response: resp ? resp.response : null, answered: !!resp };
}

// Calls decide(request, event) for every can_use_tool request and writes the answer. decide may return null to leave the request pending.
export function answerPrompts(h, decide) {
  const seen = [];
  const iv = setInterval(() => {
    for (const e of h.events) {
      if (e._answered || e.type !== 'control_request' || e.request?.subtype !== 'can_use_tool') continue;
      const d = decide(e.request, e);
      if (!d) continue;
      e._answered = true;
      seen.push({ t: e._t, tool_name: e.request.tool_name, answered_t: Date.now(), answer: d });
      h.send({ type: 'control_response', response: { subtype: 'success', request_id: e.request_id, response: d } });
    }
  }, 30);
  return { seen, stop: () => clearInterval(iv) };
}

export const toolUses = (events) => events.flatMap((e) => (e.message?.content || []).filter((b) => b.type === 'tool_use' && b.name !== 'ToolSearch').map((b) => ({ id: b.id, name: b.name, input: b.input })));
export const toolResults = (events) => events.flatMap((e) => (e.message?.content || []).filter((b) => b.type === 'tool_result').map((b) => ({ tool_use_id: b.tool_use_id, is_error: !!b.is_error, content: JSON.stringify(b.content).slice(0, 300) })));
