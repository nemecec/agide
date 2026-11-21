import { mix, parseHex, toHex } from '../colour';

export interface VsCodeColour {
  /** `#rrggbb`. */
  readonly hex: string;
  /** 0 (transparent) to 1 (opaque). */
  readonly alpha: number;
}

const VS_CODE_COLOUR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Reads `#RGB`, `#RGBA`, `#RRGGBB` or `#RRGGBBAA`. Anything else gives `undefined`. */
export function parseVsCodeColour(value: unknown): VsCodeColour | undefined {
  if (typeof value !== 'string' || !VS_CODE_COLOUR.test(value.trim())) return undefined;
  let digits = value.trim().slice(1).toLowerCase();
  if (digits.length <= 4) digits = [...digits].map((digit) => digit + digit).join('');
  const alpha = digits.length === 8 ? Number.parseInt(digits.slice(6), 16) / 255 : 1;
  return { hex: toHex(parseHex(`#${digits.slice(0, 6)}`)), alpha };
}

/** The opaque colour that `colour` shows when drawn over `surface`. */
export const composite = (colour: VsCodeColour, surface: string): string => (colour.alpha >= 1 ? colour.hex : mix(surface, colour.hex, colour.alpha));

export interface ColourHit {
  readonly key: string;
  /** Opaque, composited over the surface when one was given. */
  readonly value: string;
  /** The value exactly as the theme file wrote it. */
  readonly original: string;
}

/** The `colors` map of a theme file, read key by key. */
export class ColourMap {
  private readonly values = new Map<string, string>();

  constructor(colors: Readonly<Record<string, unknown>>) {
    for (const [key, value] of Object.entries(colors)) {
      if (typeof value === 'string' && parseVsCodeColour(value)) this.values.set(key, value.trim());
    }
  }

  has(key: string): boolean {
    return this.values.has(key);
  }

  original(key: string): string | undefined {
    return this.values.get(key);
  }

  entries(): IterableIterator<[string, string]> {
    return this.values.entries();
  }

  /** The first key of `keys` with a visible colour. A fully transparent value counts as missing. Without `surface` an alpha colour keeps its colour part. */
  first(keys: readonly string[], surface?: string): ColourHit | undefined {
    for (const key of keys) {
      const original = this.values.get(key);
      const colour = original === undefined ? undefined : parseVsCodeColour(original);
      if (!original || !colour || colour.alpha === 0) continue;
      return { key, original, value: surface === undefined ? colour.hex : composite(colour, surface) };
    }
    return undefined;
  }
}
