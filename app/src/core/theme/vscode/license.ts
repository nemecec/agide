export interface LicenseInfo {
  readonly spdx: string;
  readonly copyright: string;
  readonly text: string;
}

export const UNKNOWN_LICENSE = 'LicenseRef-unknown';

const SPDX_PATTERNS: readonly (readonly [string, RegExp])[] = [
  ['MIT', /permission is hereby granted, free of charge, to any person obtaining a copy/i],
  ['Apache-2.0', /apache license[\s,]+version 2\.0/i],
  ['ISC', /permission to use, copy, modify, and\/or distribute this software for any purpose with or without fee/i],
  ['BSD-3-Clause', /redistribution and use in source and binary forms[\s\S]*neither the name of/i],
  ['BSD-2-Clause', /redistribution and use in source and binary forms/i],
  ['MPL-2.0', /mozilla public license,? (?:version|v\.?) 2\.0/i],
  ['GPL-3.0-only', /gnu general public license[\s\S]{0,40}version 3/i],
  ['Unlicense', /this is free and unencumbered software released into the public domain/i],
];

const SPDX_ID = /^[A-Za-z0-9][A-Za-z0-9.+-]{0,63}$/;

/** The SPDX id of a license text, or the manifest's own id when it looks like one; `LicenseRef-unknown` otherwise. */
export function guessSpdx(text: string, manifestId?: string): string {
  const found = SPDX_PATTERNS.find(([, pattern]) => pattern.test(text));
  if (found) return found[0];
  return manifestId !== undefined && SPDX_ID.test(manifestId) ? manifestId : UNKNOWN_LICENSE;
}

/** The first copyright line of a license text. */
export function copyrightLine(text: string, otherwise = 'Copyright holder not stated'): string {
  const line = text.split(/\r?\n/).find((candidate) => /^\s*(?:copyright\b|\(c\)|©)/i.test(candidate));
  return (line ?? otherwise).trim().slice(0, 200);
}

/** The license of a package: the license file with its guessed id and copyright line, or undefined without a file. */
export function licenseFromFile(text: string, manifestId?: string): LicenseInfo {
  return { spdx: guessSpdx(text, manifestId), copyright: copyrightLine(text), text };
}
