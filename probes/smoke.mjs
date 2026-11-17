// README: smoke test. node smoke.mjs  -> one stream-json turn, prints event type histogram and the init keys.
import { startStream, userMsg, initOf, resultsOf, save } from './lib.mjs';
import { NOHOOKS } from './lib.mjs';
const h = startStream(['--strict-mcp-config', ...NOHOOKS]);
h.send(userMsg('Reply with the single word: ok'));
await h.waitResult(1);
await h.end();
const hist = {};
for (const e of h.events) { const k = e.type + (e.subtype ? ':' + e.subtype : '') + (e.event?.type ? ':' + e.event.type : ''); hist[k] = (hist[k] || 0) + 1; }
console.log(hist);
const init = initOf(h.events);
console.log(Object.keys(init));
console.log(JSON.stringify(resultsOf(h.events)[0], null, 1).slice(0, 2500));
console.log('stderr:', h.stderr.slice(0, 500), h.exit);
save('smoke.jsonl', h.events.map((e) => JSON.stringify(e)).join('\n'));
