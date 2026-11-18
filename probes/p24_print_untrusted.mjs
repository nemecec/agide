// README: node p24_print_untrusted.mjs  -- P24 -p half: claude -p in a fresh directory under the OS temp directory (no trust entry) runs without a trust dialog. Prints the result subtype only.
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runOnce, BASE, NOHOOKS, parseLines, save } from './lib.mjs';
const d = mkdtempSync(join(realpathSync(tmpdir()), 'p24-p-'));
const r = await runOnce(['-p', 'reply with just: ok', ...BASE, '--strict-mcp-config', '--output-format', 'stream-json', '--verbose', ...NOHOOKS], { cwd: d });
const res = parseLines(r.stdout).find((e) => e.type === 'result');
const out = { code: r.code, subtype: res?.subtype, result: res?.result, is_error: res?.is_error };
save('p24_print_untrusted.json', out); console.log(JSON.stringify(out));
rmSync(d, { recursive: true, force: true });
