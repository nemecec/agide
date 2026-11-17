import { claudeEnv } from '../session/env';
import type { ProfilePaths } from './paths';
import type { ProfileSettings } from './types';

/** Variables that select a Claude credential, removed for every profile (design 0022 section 1). */
const CLAUDE_CREDENTIALS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_PROFILE',
  'ANTHROPIC_FEDERATION_RULE_ID',
  'ANTHROPIC_ORGANIZATION_ID',
  'ANTHROPIC_IDENTITY_TOKEN_FILE',
  'CLAUDE_CONFIG_DIR',
];

/**
 * The variables an isolated profile inherits: process basics, locale, terminal, proxies and certificate files.
 * Everything else is dropped, so a credential variable the app does not know by name does not reach the agent.
 */
const ISOLATED_ALLOWED = [
  /^(PATH|HOME|USER|LOGNAME|SHELL|TMPDIR|TZ|TERM|COLORTERM|TERM_PROGRAM|TERM_PROGRAM_VERSION|EDITOR|VISUAL|PAGER|LANGUAGE|__CF_USER_TEXT_ENCODING)$/,
  /^(LANG|LC_[A-Z]+)$/,
  /^(HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|http_proxy|https_proxy|all_proxy|no_proxy)$/,
  /^(NODE_EXTRA_CA_CERTS|SSL_CERT_FILE|SSL_CERT_DIR)$/,
];

/**
 * The launch environment of a profile's sessions: the base environment scrubbed as `claudeEnv` does, without
 * Claude credential variables, with `CLAUDE_CONFIG_DIR` set only for a profile with its own directory.
 * An isolated profile keeps only the variables of an allow list, and each tool location variable is set to a
 * path inside the profile, because a removed variable alone sends the tool back to the shared default under
 * the home directory.
 */
export function profileEnv(base: NodeJS.ProcessEnv, settings: ProfileSettings, paths: ProfilePaths): Record<string, string> {
  const env = claudeEnv(base);
  for (const key of CLAUDE_CREDENTIALS) delete env[key];
  if (settings.tools.mode === 'isolated') {
    for (const key of Object.keys(env)) if (!ISOLATED_ALLOWED.some((pattern) => pattern.test(key))) delete env[key];
    env['GH_CONFIG_DIR'] = paths.tools.gh;
    env['GIT_CONFIG_GLOBAL'] = paths.tools.gitconfig;
    env['AWS_CONFIG_FILE'] = paths.tools.awsConfig;
    env['AWS_SHARED_CREDENTIALS_FILE'] = paths.tools.awsCredentials;
    env['NPM_CONFIG_USERCONFIG'] = paths.tools.npmrc;
    env['DOCKER_CONFIG'] = paths.tools.docker;
  }
  if (settings.claudeConfig.mode === 'directory') env['CLAUDE_CONFIG_DIR'] = settings.claudeConfig.path;
  return env;
}
