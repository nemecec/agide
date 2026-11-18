import type { CapabilityStatement } from './capabilityStatement';
import type { IsolationOptions } from './providerOptions';
import type { ProviderCheck, ProviderId } from './types';

/** What `isolation_status` returns. Types only, so the renderer can import them. */
export interface ProviderRow {
  readonly id: ProviderId;
  readonly check: ProviderCheck;
  readonly statement: CapabilityStatement;
  /** Whether the profile may choose it now: its check passes and a real claude has run in it. */
  readonly selectable: boolean;
  readonly selectableReason?: string;
}

export interface IsolationStatus {
  readonly selected: ProviderId;
  readonly options: IsolationOptions;
  readonly providers: readonly ProviderRow[];
}

