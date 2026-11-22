import type { Unsubscribe } from '../events/EventBus';
import type { AgentSettingsInput } from '../agents/settings';
import type { PermissionSettings } from '../permissions/types';
import type { ReviewSettingsInput } from '../review/settings';
import type { SwarmSettingsInput } from '../swarm/settings';

/**
 * Profiles (0017, design 0022 sections 1 to 4). One Electron process runs one profile. Only the definition
 * (id, name, colour, creation time) and the registry entry (liveness, unread count) cross profiles; the
 * settings stay with the owning process.
 */

/** Lowercase letters, digits and hyphens, starting with a letter, at most 32 characters. Never changes. */
export type ProfileId = string;

export const DEFAULT_PROFILE_ID: ProfileId = 'default';

/** `profile.json`: read by every profile process. */
export interface ProfileDefinition {
  readonly schema: 1;
  readonly id: ProfileId;
  /** Display name, at most 40 characters, rendered as plain text. */
  readonly name: string;
  /** `#rrggbb`. */
  readonly colour: string;
  readonly createdAt: string;
}

export type ClaudeConfigLocation =
  /** Do not set CLAUDE_CONFIG_DIR: the CLI uses its default directory and Keychain entry. */
  | { readonly mode: 'cli-default' }
  /** Set CLAUDE_CONFIG_DIR to this absolute path. */
  | { readonly mode: 'directory'; readonly path: string };

export type ToolCredentialMode =
  /** Keep the tool variables of the environment the app started with. Only the default profile uses it. */
  | { readonly mode: 'inherit' }
  | {
      readonly mode: 'isolated';
      /** Absent until the setup pane records it; the generated git file then refuses to commit. */
      readonly git?: { readonly userName: string; readonly userEmail: string };
      readonly ssh?: { readonly agentSocket: string; readonly publicKeyFile: string };
    };

/** Providers of design 0022 section 6, plus the test provider. */
export type ProviderId = 'local' | 'fake' | 'srt' | 'container' | 'openshell' | 'ssh';

/** `settings.json`: read by the profile's own process only. */
export interface ProfileSettings {
  readonly schema: 1;
  readonly claudeConfig: ClaudeConfigLocation;
  readonly tools: ToolCredentialMode;
  /** The provider sessions of this profile use unless a session names another. */
  readonly isolation: { readonly provider: ProviderId; readonly options?: unknown };
  /** Dock badge of this profile's own process. */
  readonly showBadge: boolean;
  /** Whether the unread count goes into the registry for other profiles' rails. */
  readonly shareUnread: boolean;
  /** Permission model of the profile (0028). Absent reads as `defaultPermissionSettings` from `core/permissions`. */
  readonly permissions?: PermissionSettings;
  /** Agent removal delays, the app-started cap and usage thresholds (0027). Absent keys read as the defaults. */
  readonly agents?: AgentSettingsInput;
  /** Tier table, approval timeout, spawn depth and active swarms per session (0037). Absent keys read as the defaults. */
  readonly swarm?: SwarmSettingsInput;
  /** Daily review budget, check concurrency, seen dwell and the user-level policy overlay (0040). Absent keys read as the defaults. */
  readonly review?: ReviewSettingsInput;
}

export interface NewProfileInput {
  readonly name: string;
  readonly colour: string;
  /** Derived from the name when absent; made unique with a numeric suffix. */
  readonly id?: ProfileId;
  readonly settings?: Partial<Omit<ProfileSettings, 'schema'>>;
}

export type ProfileErrorCode = 'not_found' | 'exists' | 'invalid' | 'not_owner';

export class ProfileError extends Error {
  constructor(
    readonly code: ProfileErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ProfileError';
  }
}

/**
 * Profile definitions and the own settings. Every process lists all definitions; only the owner reads and
 * writes its settings. The file implementation keeps the layout of `paths.ts` and writes atomically.
 */
export interface ProfileStore {
  /** Every profile with a valid definition, ordered by creation time, then id. */
  list(): ProfileDefinition[];
  get(id: ProfileId): ProfileDefinition | undefined;
  /** Claims the id, writes default settings and then the definition. Throws `exists` for a taken id. */
  create(input: NewProfileInput): ProfileDefinition;
  /** Settings of the profile this store belongs to. Throws `not_owner` for another profile. */
  readSettings(id: ProfileId): ProfileSettings;
  updateSettings(id: ProfileId, change: Partial<Omit<ProfileSettings, 'schema'>>): ProfileSettings;
  /** Name and colour of the own profile. Throws `not_owner` for another profile. */
  updateDefinition(id: ProfileId, change: { readonly name?: string; readonly colour?: string }): ProfileDefinition;
}

/** `registry/<id>.json` (design 0022 section 3). Nothing else crosses profiles at run time. */
export interface RegistryEntry {
  readonly schema: 1;
  readonly profileId: ProfileId;
  readonly pid: number;
  /** Random per process start; a changed value means a restart. */
  readonly instanceId: string;
  /** Refreshed at least every 30 seconds while the process runs. */
  readonly updatedAt: string;
  /** Unread inbox items (R21). Omitted when `shareUnread` is off. */
  readonly unread?: number;
}

/** What the rail and the renderer see of a profile's registry entry. */
export interface ProfileStatus {
  readonly profileId: ProfileId;
  /** The pid is alive and the entry is younger than `REGISTRY_STALE_MS`. */
  readonly running: boolean;
  readonly unread?: number;
}

/** An entry older than this shows its profile as not running. */
export const REGISTRY_STALE_MS = 90_000;

/**
 * The cross-profile registry as one profile's process sees it: it writes its own entry and reads every
 * entry. Readers never delete another profile's entry.
 */
export interface ProfileRegistry {
  readonly ownProfileId: ProfileId;
  /** Writes or replaces the own entry with a fresh `updatedAt`. `unread` undefined omits the count. */
  publish(update: { readonly unread?: number | undefined }): void;
  /** Removes the own entry (clean quit). */
  withdraw(): void;
  /** One status per profile with a valid entry, sorted by profile id. */
  statuses(): ProfileStatus[];
  /** Called when any entry may have changed. File implementations debounce. */
  subscribe(listener: (statuses: ProfileStatus[]) => void): Unsubscribe;
  /** Stops watching. Does not withdraw the own entry. */
  dispose(): void;
}

export type ProfileEvent = { readonly type: 'profile.statuses_changed'; readonly statuses: readonly ProfileStatus[] };

/** The profile this process runs, chosen before Electron's `ready` (design 0022 section 2). */
export interface ResolvedProfile {
  /** App root holding `profiles/` and `registry/`. */
  readonly root: string;
  readonly id: ProfileId;
}

/** What the profile module gives the other modules. */
export interface ProfileService {
  readonly id: ProfileId;
  definition(): ProfileDefinition;
  settings(): ProfileSettings;
  readonly store: ProfileStore;
  readonly registry: ProfileRegistry;
}
