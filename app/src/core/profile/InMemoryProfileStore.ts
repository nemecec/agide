import { z } from 'zod';
import { profilePaths } from './paths';
import { defaultSettings, profileDefinitionSchema, profileIdFromName, profileIdSchema, profileSettingsSchema } from './schemas';
import {
  DEFAULT_PROFILE_ID,
  ProfileError,
  type NewProfileInput,
  type ProfileDefinition,
  type ProfileId,
  type ProfileSettings,
  type ProfileStore,
} from './types';

export interface InMemoryProfileStoreOptions {
  /** The profile whose process uses this store. */
  readonly ownerId: ProfileId;
  /** App root used to compute the Claude directory of new profiles. */
  readonly root?: string;
  readonly now?: () => Date;
}

/** Reference implementation of `ProfileStore`. The file store must pass the same contract. */
export class InMemoryProfileStore implements ProfileStore {
  private readonly definitions = new Map<ProfileId, ProfileDefinition>();
  private readonly settings = new Map<ProfileId, ProfileSettings>();
  private readonly root: string;
  private readonly now: () => Date;

  constructor(private readonly options: InMemoryProfileStoreOptions) {
    this.root = options.root ?? '/agide';
    this.now = options.now ?? (() => new Date());
  }

  list(): ProfileDefinition[] {
    return [...this.definitions.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }

  get(id: ProfileId): ProfileDefinition | undefined {
    return this.definitions.get(id);
  }

  create(input: NewProfileInput): ProfileDefinition {
    const id = input.id ?? this.uniqueId(profileIdFromName(input.name));
    if (!profileIdSchema.safeParse(id).success) throw new ProfileError('invalid', `profile id ${id} is not valid`);
    if (this.definitions.has(id)) throw new ProfileError('exists', `profile ${id} exists`);
    const definition = parse<ProfileDefinition>(profileDefinitionSchema, {
      schema: 1,
      id,
      name: input.name.trim(),
      colour: input.colour,
      createdAt: this.now().toISOString(),
    });
    const base = defaultSettings({ isDefaultProfile: id === DEFAULT_PROFILE_ID, claudeConfigDir: profilePaths(this.root, id).claude });
    const settings = parse<ProfileSettings>(profileSettingsSchema, { ...base, ...input.settings, schema: 1 });
    this.settings.set(id, settings);
    this.definitions.set(id, definition);
    return definition;
  }

  readSettings(id: ProfileId): ProfileSettings {
    this.requireOwner(id);
    const settings = this.settings.get(id);
    if (!settings) throw new ProfileError('not_found', `profile ${id} has no settings`);
    return settings;
  }

  updateSettings(id: ProfileId, change: Partial<Omit<ProfileSettings, 'schema'>>): ProfileSettings {
    const next = parse<ProfileSettings>(profileSettingsSchema, { ...this.readSettings(id), ...change, schema: 1 });
    this.settings.set(id, next);
    return next;
  }

  updateDefinition(id: ProfileId, change: { readonly name?: string; readonly colour?: string }): ProfileDefinition {
    this.requireOwner(id);
    const current = this.definitions.get(id);
    if (!current) throw new ProfileError('not_found', `no profile ${id}`);
    const next = parse<ProfileDefinition>(profileDefinitionSchema, {
      ...current,
      ...(change.name === undefined ? {} : { name: change.name.trim() }),
      ...(change.colour === undefined ? {} : { colour: change.colour }),
    });
    this.definitions.set(id, next);
    return next;
  }

  private requireOwner(id: ProfileId): void {
    if (id !== this.options.ownerId) throw new ProfileError('not_owner', `profile ${this.options.ownerId} cannot change or read the settings of ${id}`);
  }

  private uniqueId(base: string): ProfileId {
    if (!this.definitions.has(base)) return base;
    for (let n = 2; ; n++) {
      const candidate = `${base}-${n}`;
      if (!this.definitions.has(candidate)) return candidate;
    }
  }
}

/** zod types optional keys as `T | undefined`; a parsed object never holds an `undefined` value for them. */
function parse<T>(schema: z.ZodType, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ProfileError('invalid', z.prettifyError(result.error));
  return result.data as T;
}
