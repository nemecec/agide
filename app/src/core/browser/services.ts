import type { ObserveMode } from '../surfaces/types';
import type { ServiceId } from './types';

/** Observation default per service (0026 section 2): Slack and Discord start off. */
export const OBSERVATION_DEFAULT: Readonly<Record<ServiceId, ObserveMode>> = {
  jira: 'on-demand',
  github: 'on-demand',
  notion: 'on-demand',
  slack: 'off',
  discord: 'off',
  web: 'on-demand',
};

/** Slack and Discord tabs never give page content or input to agents; the connector carries the content. */
export const isChatService = (service: ServiceId): boolean => service === 'slack' || service === 'discord';

/** Sign-in hosts belong to no service, so a sign-in flow stays in the tab that started it. Extensible per profile. */
export const SIGN_IN_HOSTS: readonly string[] = ['id.atlassian.com', 'accounts.google.com', 'login.microsoftonline.com'];

const endsWith = (host: string, suffix: string) => host === suffix || host.endsWith(`.${suffix}`);

/** The service of a parsed host, case-insensitive; `undefined` for a sign-in host. */
export function serviceForHost(rawHost: string): ServiceId | undefined {
  const host = rawHost.toLowerCase();
  if (SIGN_IN_HOSTS.includes(host)) return undefined;
  if (host.endsWith('.atlassian.net')) return 'jira';
  if (host === 'github.com') return 'github';
  if (host === 'notion.so' || host === 'www.notion.so' || host.endsWith('.notion.site')) return 'notion';
  if (endsWith(host, 'slack.com')) return 'slack';
  if (endsWith(host, 'discord.com')) return 'discord';
  return 'web';
}
