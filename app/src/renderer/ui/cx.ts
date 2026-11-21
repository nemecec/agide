/** Joins class names, skipping the ones that are false or empty. */
export function cx(...names: readonly (string | false | null | undefined)[]): string {
  return names.filter((name): name is string => typeof name === 'string' && name !== '').join(' ');
}
