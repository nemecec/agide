import { LocalProvider } from './LocalProvider';
import { IsolationError, type IsolationProvider, type ProviderId } from './types';

/** Builds a provider the first time a profile or session asks for it. */
export type ProviderFactory = () => IsolationProvider;

/**
 * The providers a profile process can launch through (0029). The session module asks it for the provider of
 * every launch. `local` is always present; w-iso registers `srt` and `container` once they pass the contract.
 */
export class IsolationProviders {
  private readonly factories = new Map<ProviderId, ProviderFactory>();
  private readonly created = new Map<ProviderId, IsolationProvider>();

  constructor(local: { readonly sessionFilesDir: string; readonly claudeBinary?: string } | ProviderFactory) {
    this.factories.set('local', typeof local === 'function' ? local : () => new LocalProvider(local));
  }

  /** Adds or replaces the factory of a provider id. A provider already created keeps running until `dispose`. */
  register(id: ProviderId, factory: ProviderFactory): void {
    this.factories.set(id, factory);
  }

  /** Forgets the created provider of `id`, so the next `get` builds one from the current options. Environments already prepared keep running. */
  reset(id: ProviderId): void {
    this.created.delete(id);
  }

  /** Provider ids that can be chosen, `local` first. */
  ids(): ProviderId[] {
    return [...this.factories.keys()];
  }

  /** The provider for `id`, created once. Throws `unsupported` for an id without a factory. */
  get(id: ProviderId): IsolationProvider {
    const existing = this.created.get(id);
    if (existing) return existing;
    const factory = this.factories.get(id);
    if (!factory) throw new IsolationError('unsupported', `the isolation provider ${id} is not available`);
    const provider = factory();
    this.created.set(id, provider);
    return provider;
  }
}
