import { join } from 'node:path';
import { z } from 'zod';
import { CommandError, type CommandRegistry } from '../commands/index';
import type { ProfileService } from '../profile/types';
import { describeProvider } from './capabilityStatement';
import { ContainerProvider, ownerIdOf } from './ContainerProvider';
import type { HostTools } from './hostTools';
import { readIsolationOptions, type IsolationOptions } from './providerOptions';
import type { IsolationStatus, ProviderRow } from './statusTypes';
import { IsolationProviders } from './providerRegistry';
import { SrtProvider } from './SrtProvider';
import { IsolationError, type IsolationProvider, type ProviderId } from './types';

export interface ProviderSetup {
  /** Host directory for 0600 session files, `<profile data>/sessions`. */
  readonly sessionFilesDir: string;
  /** The profile's data directory, for provider state such as generated srt settings. */
  readonly dataDir: string;
  /** The profile's `isolation.options`, read before each provider is built. */
  readonly options: () => unknown;
  /** Finds the host-side programs of the providers; the profile process builds it from `agentWritableDirectories`. Without it each provider excludes what it lets an agent write itself. */
  readonly hostTools?: HostTools;
  /** Directories below which agents get their workspaces (the task base). */
  readonly agentRoots?: readonly string[];
}

const hostToolOptions = (setup: ProviderSetup) => ({
  ...(setup.hostTools === undefined ? {} : { hostTools: setup.hostTools }),
  ...(setup.agentRoots === undefined ? {} : { agentRoots: setup.agentRoots }),
});

/** The providers a profile can choose. `fake`, `openshell` and `ssh` are not offered. */
export const CHOOSABLE_PROVIDERS: readonly ProviderId[] = ['local', 'srt', 'container'];

/** Builds the srt or container provider of a profile process for the given options. */
export function buildIsolatingProvider(id: ProviderId, setup: ProviderSetup, options: IsolationOptions): IsolationProvider {
  if (id === 'srt') {
    return new SrtProvider({
      sessionFilesDir: setup.sessionFilesDir,
      srtBinary: options.srtBinary ?? process.env['AGIDE_SRT_BIN'] ?? 'srt',
      settingsDir: join(setup.dataDir, 'isolation', 'srt'),
      ...hostToolOptions(setup),
      ...(options.extraWritePaths === undefined ? {} : { extraWritePaths: options.extraWritePaths }),
      ...(options.extraDenyRead === undefined ? {} : { extraDenyRead: options.extraDenyRead }),
    });
  }
  if (id !== 'container') throw new IsolationError('unsupported', `the isolation provider ${id} is not built from options`);
  return new ContainerProvider({
    sessionFilesDir: setup.sessionFilesDir,
    dockerBinary: options.dockerBinary ?? 'docker',
    image: options.containerImage ?? 'agide-claude',
    claudeConfigDir: join(setup.dataDir, 'isolation', 'container', 'claude'),
    user: `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`,
    ownerId: ownerIdOf(setup.dataDir),
    ...hostToolOptions(setup),
  });
}

/** The providers of a profile process, with the setup they are built from, so the commands can try options that are not saved yet. */
class ConfiguredProviders extends IsolationProviders {
  constructor(readonly setup: ProviderSetup) {
    super({ sessionFilesDir: setup.sessionFilesDir });
  }
}

/** The providers a profile process offers: `local`, plus `srt` and `container` built from the profile's options on first use. */
export function createIsolationProviders(setup: ProviderSetup): IsolationProviders {
  const providers = new ConfiguredProviders(setup);
  providers.register('srt', () => buildIsolatingProvider('srt', setup, readIsolationOptions(setup.options())));
  providers.register('container', () => {
    const provider = buildIsolatingProvider('container', setup, readIsolationOptions(setup.options())) as ContainerProvider;
    void provider.removeOrphans();
    return provider;
  });
  return providers;
}

async function rowOf(id: ProviderId, provider: IsolationProvider): Promise<ProviderRow> {
  const check = await provider.check();
  const statement = describeProvider(id, provider.capabilities);
  if (!check.ok) return { id, check, statement, selectable: false, selectableReason: check.reason };
  if (!statement.verifiedWithClaude) return { id, check, statement, selectable: false, selectableReason: 'No real claude has run in it yet.' };
  return { id, check, statement, selectable: true };
}

const optionsInput = z.object({
  srtBinary: z.string().trim().min(1).max(512).optional(),
  dockerBinary: z.string().trim().min(1).max(512).optional(),
  containerImage: z.string().trim().min(1).max(256).optional(),
});

const choosable = z.enum(['local', 'srt', 'container']);

export interface IsolationCommandDeps {
  readonly providers: IsolationProviders;
  readonly profile: ProfileService;
}

/**
 * Commands of the isolation setup: `isolation_status` lists the providers with their check and capability
 * statement (optionally with options to try), `isolation_set_provider` saves the choice once the provider passes
 * its check. Not tools: an agent does not choose its own isolation. Returns the functions that unregister them.
 */
export function registerIsolationCommands(commands: CommandRegistry, deps: IsolationCommandDeps): (() => void)[] {
  const saved = (): { provider: ProviderId; options: IsolationOptions } => {
    const { isolation } = deps.profile.settings();
    return { provider: isolation.provider, options: readIsolationOptions(isolation.options) };
  };
  const candidate = (id: ProviderId, tried: IsolationOptions): IsolationProvider => {
    const setup = deps.providers instanceof ConfiguredProviders ? deps.providers.setup : undefined;
    if (id === 'local' || setup === undefined || Object.keys(tried).length === 0) return deps.providers.get(id);
    return buildIsolatingProvider(id, setup, { ...saved().options, ...tried });
  };

  return [
    commands.register({
      id: 'isolation_status',
      title: 'Isolation status',
      description: 'Lists the isolation providers with their check result and what each isolates, and says which one the profile uses. Options given are tried without saving them.',
      input: optionsInput,
      ui: false,
      mcp: false,
      run: async (input): Promise<IsolationStatus> => {
        const { provider: selected, options } = saved();
        const providers = await Promise.all(CHOOSABLE_PROVIDERS.map((id) => rowOf(id, candidate(id, input))));
        return { selected, options: { ...options, ...input }, providers };
      },
    }),
    commands.register({
      id: 'isolation_set_provider',
      title: 'Choose isolation provider',
      description: 'Sets the provider the profile launches sessions through, with optional paths or image. Refused when the provider fails its check.',
      input: optionsInput.extend({ provider: choosable }),
      ui: false,
      mcp: false,
      run: async (input) => {
        const { provider: id, ...tried } = input;
        const row = await rowOf(id, candidate(id, tried));
        if (!row.selectable) {
          const fix = row.check.ok ? '' : (row.check.fix ?? '');
          throw new CommandError('failed', [row.selectableReason ?? 'The provider is not available.', fix].filter(Boolean).join(' '));
        }
        const options: IsolationOptions = { ...saved().options, ...tried };
        deps.profile.store.updateSettings(deps.profile.id, { isolation: { provider: id, options } });
        if (id !== 'local') deps.providers.reset(id);
        return { provider: id };
      },
    }),
  ];
}
