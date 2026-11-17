// README: node p5_subagents.mjs [stream|failure|all] -- P5: subagent event shapes in -p stream-json (haiku, budget capped). Writes out/p5_*.jsonl and out/p5_report_*.json. Spends a few cents per run.
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { startStream, userMsg, save, OUT, initOf, resultsOf } from './lib.mjs';

const which = process.argv[2] || 'stream';

const PROMPTS = {
  stream: 'Use the Agent tool to start exactly two subagents in the same message so they run in parallel. Subagent one: reply with only the word ok. Subagent two: reply with only the word ok. Do not use any other tool. When both are done reply with the word done.',
  approval: 'Use the Agent tool once with run_in_background false. The subagent must call the Write tool to create the file p5_probe.txt containing the word ok, then reply with only the word written. Report what the subagent returned in one sentence.',
  background: 'Use the Agent tool once with run_in_background true. The subagent replies with only the word ok. After starting it, reply with the word started and end your turn.',
  workflow: 'Use the Workflow tool with an inline script that runs two agent() calls in parallel() with phase("p"): each agent prompt is "Reply with only the word ok. Use no tools." and label "a" and "b". Return the results. Then say done.',
  failure: 'Use the Agent tool once with subagent_type "no-such-agent-type" and prompt "say ok". Then report in one sentence what the tool returned.',
};

async function run(name, extraFlags) {
  const log = createWriteStream(join(OUT, `p5_${name}.jsonl`));
  const approval = name === 'approval' || name === 'workflow';
  const h = startStream(['--strict-mcp-config', '--permission-mode', name === 'approval' ? 'manual' : 'acceptEdits', ...(approval || name === 'workflow' ? ['--permission-prompt-tool', 'stdio'] : []), '--settings', '{"disableAllHooks":true}', ...extraFlags], { log });
  const asks = [];
  if (approval) {
    const iv = setInterval(() => {
      for (const e of h.events) {
        if (e.type === 'control_request' && e.request?.subtype === 'can_use_tool' && !e._answered) {
          e._answered = true; asks.push({ t: e._t - h.events[0]._t, request: e.request, keys: Object.keys(e) });
          h.send({ type: 'control_response', response: { subtype: 'success', request_id: e.request_id, response: name === 'workflow' ? { behavior: 'allow', updatedInput: e.request.input } : { behavior: 'deny', message: 'host says no' } } });
        }
      }
    }, 50);
    h.closed.then(() => clearInterval(iv));
  }
  h.send(userMsg(PROMPTS[name]));
  await h.waitResult(name === 'background' || name === 'approval' || name === 'workflow' ? 2 : 1, 150000); // background agents end a second turn; keep stdin open so approvals can be answered
  await h.end(); log.end();
  const ev = h.events;
  const shape = (e) => ({
    t: e._t - ev[0]._t, type: e.type, subtype: e.subtype, parent: e.parent_tool_use_id ?? undefined,
    task_id: e.task_id, tool_use_id: e.tool_use_id, status: e.status,
    tools: (e.message?.content || []).filter((b) => b.type === 'tool_use').map((b) => ({ name: b.name, id: b.id })),
    results: (e.message?.content || []).filter((b) => b.type === 'tool_result').map((b) => ({ id: b.tool_use_id, err: b.is_error })),
    keys: e.type === 'system' ? Object.keys(e) : undefined,
  });
  const interesting = ev.filter((e) => e.type !== 'stream_event' && e.type !== 'rate_limit_event');
  const report = {
    name, version: initOf(ev)?.claude_code_version, tools_has_workflow: (initOf(ev)?.tools || []).filter((t) => /workflow|agent|task/i.test(t)),
    event_types: Object.fromEntries([...new Set(ev.map((e) => e.type + '/' + (e.subtype || '')))].map((k) => [k, ev.filter((e) => e.type + '/' + (e.subtype || '') === k).length])),
    timeline: interesting.map(shape),
    result: resultsOf(ev).map((r) => ({ subtype: r.subtype, cost: r.total_cost_usd, turns: r.num_turns, is_error: r.is_error })),
    approval_requests: asks, exit: h.exit, stderr: h.stderr.slice(0, 500),
  };
  save(`p5_report_${name}.json`, report);
  console.log(JSON.stringify({ name, event_types: report.event_types, result: report.result, workflowTools: report.tools_has_workflow }, null, 1));
}

if (which === 'stream' || which === 'all') await run('stream', []);
if (which === 'approval' || which === 'all') await run('approval', []);
if (which === 'background' || which === 'all') await run('background', []);
if (which === 'workflow') await run('workflow', []);
if (which === 'failure' || which === 'all') await run('failure', []);
