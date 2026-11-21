/** sRGB colour arithmetic and the WCAG 2 contrast ratio. All colours are `#rgb` or `#rrggbb` strings. */

export type Rgb = readonly [number, number, number];

export function parseHex(value: string): Rgb {
  let digits = value.replace('#', '');
  if (digits.length === 3) digits = [...digits].map((digit) => digit + digit).join('');
  return [0, 2, 4].map((at) => Number.parseInt(digits.slice(at, at + 2), 16)) as unknown as Rgb;
}

const byte = (value: number): string => Math.round(Math.max(0, Math.min(255, value))).toString(16).padStart(2, '0');

export const toHex = (rgb: Rgb): string => `#${rgb.map(byte).join('')}`;

/** `#rrggbbaa` of an opaque colour at the given opacity (0 to 1). */
export const withAlpha = (value: string, opacity: number): string => `${toHex(parseHex(value))}${byte(opacity * 255)}`;

const linear = (channel: number): number => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

export function luminance(value: string): number {
  const [r, g, b] = parseHex(value).map(linear) as unknown as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function ratio(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** The sRGB mix of `fraction` (0 to 1) of `b` into `a`. */
export function mix(a: string, b: string, fraction: number): string {
  const from = parseHex(a);
  const to = parseHex(b);
  return toHex(from.map((channel, index) => channel + ((to[index] ?? 0) - channel) * fraction) as unknown as Rgb);
}

export interface Clamped {
  readonly colour: string | undefined;
  /** Percent of the way toward `towards` that the colour moved. */
  readonly step: number;
}

/** Moves `base` toward `towards` in 2 percent steps until `reaches` accepts it. */
export function clampUntil(base: string, towards: string, reaches: (candidate: string) => boolean): Clamped {
  for (let index = 0; index <= 50; index++) {
    const candidate = mix(base, towards, index * 0.02);
    if (reaches(candidate)) return { colour: candidate, step: index * 2 };
  }
  return { colour: undefined, step: 100 };
}

export const clampTo = (base: string, towards: string, against: string, target: number): Clamped =>
  clampUntil(base, towards, (candidate) => ratio(candidate, against) >= target);
