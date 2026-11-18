import type { PermissionSettings } from './types';

/** GitHub and the npm, PyPI and Maven Central registries (0028 section 5; the user confirms the list). */
export const DEFAULT_NETWORK_ALLOWLIST: readonly string[] = [
  'github.com',
  'api.github.com',
  'codeload.github.com',
  'objects.githubusercontent.com',
  'registry.npmjs.org',
  'pypi.org',
  'files.pythonhosted.org',
  'repo.maven.apache.org',
];

/**
 * The settings of a profile whose `settings.json` has no `permissions` key. Auto is the default mode (0025). The
 * Bash sandbox is on for new profiles and off for the default profile, whose git remotes may use ssh (0028 section 5).
 */
export function defaultPermissionSettings(options: { readonly isDefaultProfile: boolean }): PermissionSettings {
  return {
    defaultMode: 'auto',
    network: { bashSandbox: !options.isDefaultProfile, allow: DEFAULT_NETWORK_ALLOWLIST, deny: [] },
    trustAppCreatedFolders: false,
  };
}

/** The stored settings, or the defaults when the profile has none. */
export function permissionSettingsOf(
  settings: { readonly permissions?: PermissionSettings | undefined },
  options: { readonly isDefaultProfile: boolean },
): PermissionSettings {
  return settings.permissions ?? defaultPermissionSettings(options);
}
