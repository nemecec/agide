import { qualifiesForBypass } from '../permissions/modes';
import type { ProviderCapabilities, ProviderId } from './types';

/** What a provider isolates and what it leaves open, in words for the settings panel. */
export interface CapabilityStatement {
  readonly provider: ProviderId;
  readonly label: string;
  readonly isolated: readonly string[];
  readonly notIsolated: readonly string[];
  readonly bypass: { readonly allowed: boolean; readonly reason: string };
  /** Whether a real `claude` has run inside this provider. A provider without it is listed but not offered. */
  readonly verifiedWithClaude: boolean;
  /** Extra remarks: cost, install, open questions. */
  readonly notes: readonly string[];
}

interface Text {
  readonly label: string;
  readonly isolated: readonly string[];
  readonly notIsolated: readonly string[];
  readonly verifiedWithClaude: boolean;
  readonly notes: readonly string[];
}

const TEXT: Partial<Record<ProviderId, Text>> = {
  local: {
    label: 'This computer, as your user',
    isolated: [],
    notIsolated: [
      'Files: the agent can read and write whatever your user can.',
      'Network: no limit other than the ask rules of the permission model.',
      'Login: the Claude login stays in the Keychain, where the agent can read it.',
    ],
    verifiedWithClaude: true,
    notes: [],
  },
  srt: {
    label: 'Sandbox runtime (srt)',
    isolated: [
      'Writes: only the workspace, the session folder of this app, the Claude configuration and the CLI temp directory. The settings, instructions, commands, agents, skills and plugins of the Claude configuration are read-only.',
      'Network: only the allowed hosts, for the whole agent process.',
      'Browser: a tab an agent opened or drives loads loopback, the allowed hosts and origins you let it open, and nothing else.',
    ],
    notIsolated: [
      'Reads: the agent can read the files your user can read.',
      'Loopback: every port on this computer is open to the agent, because the app MCP server needs it.',
      'Claude state file: the agent can write .claude.json, which holds the MCP servers of your user and the state of the CLI.',
      'Browser: tabs you opened and the sign-in windows of a service are not held to the allowed hosts.',
      'Login: the Claude login stays in the Keychain, where the agent can read it.',
    ],
    verifiedWithClaude: true,
    notes: ['A start takes about 0.2 s longer than on this computer.'],
  },
  container: {
    label: 'Container (Docker)',
    isolated: ['Files: the agent sees the workspace, its own Claude configuration and the session folder only.', 'Login: separate from your own; the agent signs in inside the container.'],
    notIsolated: [
      'Network: no limit; the container reaches whatever Docker lets it reach.',
      'Login: the container login is a file the agent can read.',
      'GitHub: the gh configuration of the profile is mounted read-only; a token in it is readable by the agent.',
      'Tool-call check: the hook that checks every tool call cannot run inside the image, so only the ask rules apply.',
    ],
    verifiedWithClaude: false,
    notes: [
      'Not verified with Claude: no real claude has run in a container yet, so the provider is listed and not offered for sessions.',
      'The image has to hold a Linux claude, git, ripgrep and certificates. The app never pulls images.',
    ],
  },
};

function bypassStatement(capabilities: ProviderCapabilities, id: ProviderId): CapabilityStatement['bypass'] {
  if (qualifiesForBypass(capabilities)) {
    return {
      allowed: true,
      reason:
        id === 'srt'
          ? 'Allowed: files and the network are limited for the whole agent process. The permission settings keep the option hidden until its safety probe has run.'
          : 'Allowed: files and the network are limited for the whole agent process.',
    };
  }
  const missing: string[] = [];
  if (capabilities.filesystem !== 'enforced') missing.push('limits files');
  if (capabilities.network !== 'allowlist') missing.push('limits the network of the whole process');
  return { allowed: false, reason: `Not allowed: bypass needs a provider that ${missing.join(' and ')}.` };
}

/** The statement of a provider. An id without text gets one built from its capabilities only. */
export function describeProvider(id: ProviderId, capabilities: ProviderCapabilities): CapabilityStatement {
  const text = TEXT[id];
  return {
    provider: id,
    label: text?.label ?? id,
    isolated: text?.isolated ?? [],
    notIsolated: text?.notIsolated ?? [],
    bypass: bypassStatement(capabilities, id),
    verifiedWithClaude: text?.verifiedWithClaude ?? false,
    notes: text?.notes ?? [],
  };
}
