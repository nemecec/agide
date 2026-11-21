// Walks the app's states in a window of fixed size on fake data and writes one PNG per state.
//   pnpm visual-check [--hidden] [--only <phase,phase>] [--out <parent directory>]
// Every run writes a new directory under the OS temporary directory (or --out), so a run before and a run after a
// change can be compared. The app must be built first (pnpm build).
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRun, MAIN } from './lib/visual/harness.mjs';
import { phaseAppearance } from './lib/visual/phaseAppearance.mjs';
import { phaseBrowser } from './lib/visual/phaseBrowser.mjs';
import { phaseErrors } from './lib/visual/phaseErrors.mjs';
import { phaseFocus } from './lib/visual/phaseFocus.mjs';
import { phaseTheme } from './lib/visual/phaseTheme.mjs';
import { phaseProfiles } from './lib/visual/phaseProfiles.mjs';
import { phaseWorkspace } from './lib/visual/phaseWorkspace.mjs';

const PHASES = {
  empty: phaseWorkspace.empty,
  workspace: phaseWorkspace.populated,
  dialogs: phaseWorkspace.dialogs,
  agents: phaseWorkspace.agents,
  inbox: phaseWorkspace.inbox,
  browser: phaseBrowser,
  profiles: phaseProfiles,
  errors: phaseErrors,
  appearance: phaseAppearance,
  focus: phaseFocus,
  theme: phaseTheme,
};

const argument = (name) => {
  const at = process.argv.indexOf(name);
  return at < 0 ? undefined : process.argv[at + 1];
};

if (!existsSync(MAIN)) {
  console.error('The app is not built: run pnpm build first.');
  process.exit(1);
}

const only = argument('--only')?.split(',');
const run = createRun(argument('--out'));
const context = { run, forceHidden: process.argv.includes('--hidden'), phases: [] };
console.log(`screenshots: ${run.shots}`);
const started = new Date().toISOString();

for (const [name, phase] of Object.entries(PHASES)) {
  if (only && !only.includes(name)) continue;
  const begin = Date.now();
  try {
    await phase(context);
    context.phases.push({ name, ok: true, seconds: Math.round((Date.now() - begin) / 1000) });
  } catch (error) {
    run.note(`phase ${name} failed: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
    console.error(error);
    context.phases.push({ name, ok: false, seconds: Math.round((Date.now() - begin) / 1000) });
  }
}

writeFileSync(join(run.shots, 'sources.json'), JSON.stringify({ started, finished: new Date().toISOString(), sources: run.sources, notes: run.notes, phases: context.phases }, null, 2));
run.cleanup();
console.log(`done: ${run.shots}`);
