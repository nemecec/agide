import { POLICY_PATH } from '../policy/schema';
import type { Reason } from '../schemas';
import { escapePath, isAgentConfig, isBuildFile, isCiConfig, isDependencyFile, isGitConfig, isPackageJson, isTestLintConfig, packageJsonChange } from './classify';
import { nameOf, pathsOf, type RuleContext } from './context';
import { firstMatch } from './glob';
import { protectedEntry } from './protectedPaths';

/** Reasons from where the changeset writes (0040 section 7.2): policy paths, protected paths, configuration, dependencies and the agent's own area. */

/** Path-shaped arguments of the check commands: a changed file named there changes what the check runs. */
function checkScriptPaths(ctx: RuleContext): ReadonlySet<string> {
  const argv = [...(ctx.policy.check?.setup ?? []), ...(ctx.policy.check?.command ?? [])];
  return new Set(argv.map((token) => token.replace(/^\.\//, '')).filter((token) => token !== '' && !token.startsWith('-')));
}

export function pathReasons(ctx: RuleContext): Reason[] {
  const { make, policy, input } = ctx;
  const reasons: Reason[] = [];
  const scriptPaths = checkScriptPaths(ctx);
  const otherPaths = Object.entries(input.otherAgentsPaths);

  for (const file of ctx.files) {
    const paths = pathsOf(file);
    const name = nameOf(file);
    const shown = escapePath(name);
    const at = (id: Parameters<typeof make>[0], extra: Record<string, unknown> = {}): void => {
      reasons.push(make(id, { subject: shown, evidence: { path: shown, ...extra } }));
    };
    const glob = (globs: readonly string[]): string | undefined => paths.map((path) => firstMatch(path, globs)).find((hit) => hit !== undefined);

    const sensitive = glob(policy.paths.sensitive);
    if (sensitive !== undefined) at('path.sensitive', { glob: sensitive });
    const migration = glob(policy.paths.migrations);
    if (migration !== undefined) at('path.migration', { glob: migration });
    const protectedHit = paths.map(protectedEntry).find((hit) => hit !== undefined);
    if (protectedHit !== undefined) at('path.protected', { protected: protectedHit });

    if (input.owns.length > 0 && !paths.some((path) => firstMatch(path, input.owns) !== undefined)) at('path.outside_owns', { owns: input.owns.slice(0, 20) });
    const overlapping = otherPaths.filter(([, others]) => paths.some((path) => others.includes(path))).map(([agent]) => agent);
    if (overlapping.length > 0) at('path.overlap', { agents: overlapping.slice(0, 20) });

    if (paths.some(isAgentConfig)) at('config.agent');
    if (paths.some(isGitConfig)) at('config.git');
    if (paths.some((path) => path === POLICY_PATH)) at('policy.changed');
    if (paths.some(isCiConfig)) at('config.ci');

    const packageChange = paths.some(isPackageJson) ? packageJsonChange(ctx.hunksOf(file).map((hunk) => hunk.body)) : undefined;
    const testConfig = glob(policy.paths.testConfig);
    if (paths.some(isTestLintConfig) || testConfig !== undefined || paths.some((path) => scriptPaths.has(path)) || packageChange?.scripts === true) {
      at('config.test_lint', testConfig === undefined ? {} : { glob: testConfig });
    }
    if (paths.some(isDependencyFile) || packageChange?.dependencies === true) at('deps.changed');
    const buildGlob = glob(policy.paths.build);
    if (paths.some(isBuildFile) || buildGlob !== undefined) at('build.changed', buildGlob === undefined ? {} : { glob: buildGlob });
  }
  return reasons;
}
