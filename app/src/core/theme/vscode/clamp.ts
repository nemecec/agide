import { clampUntil, mix, ratio } from '../colour';
import type { TokenValues } from '../contrast';

export interface Adjustment {
  readonly token: string;
  readonly from: string;
  readonly to: string;
  readonly reason: string;
}

const BLACK = '#000000';
const WHITE = '#ffffff';

const TEXT_SURFACES = ['surface.window', 'surface.sidebar', 'surface.content', 'surface.raised', 'surface.overlay', 'surface.inset', 'selection', 'selection.inactive'];
const CARRIER_SURFACES = ['surface.window', 'surface.content', 'surface.sidebar', 'surface.raised', 'surface.overlay'];
const STATUS_SURFACES = [...CARRIER_SURFACES, 'selection', 'selection.inactive'];
const STATUSES = ['success', 'warning', 'danger', 'info'] as const;
const FILL_TOKENS = ['accent', 'accent.hover', 'accent.active'];
const SUBTLE_PERCENT = { light: 14, dark: 20 } as const;
const STATUS_BG_PERCENT = 16;

const lowest = (colour: string, surfaces: readonly string[]): number => Math.min(...surfaces.map((surface) => ratio(colour, surface)));

/**
 * The contrast clamp of 0035 6.2 over a complete token set. Text and icon colours move toward white (dark themes) or
 * black (light themes) in 2 percent steps until they pass against every surface of their rows; fills move away from
 * the text on them. Surfaces never move. A colour that no step can fix stays as it is and the verification of the
 * caller reports it.
 */
export class ContrastClamp {
  readonly adjustments: Adjustment[] = [];
  private readonly towards: string;

  constructor(
    readonly tokens: Record<string, string>,
    private readonly dark: boolean,
    /** Tokens whose value the mapping derived from others; they follow when their source moves. */
    private readonly derived: ReadonlySet<string>,
  ) {
    this.towards = dark ? WHITE : BLACK;
  }

  private get(key: string): string {
    const value = this.tokens[key];
    if (value === undefined) throw new Error(`token ${key} is missing`);
    return value;
  }

  /** Records a change. A token that moves twice keeps its first original value and the last reason; one that returns to its original value is dropped. */
  private set(key: string, to: string, reason: string): void {
    const from = this.get(key);
    if (from === to) return;
    this.tokens[key] = to;
    const earlier = this.adjustments.findIndex((adjustment) => adjustment.token === key);
    const first = earlier < 0 ? from : (this.adjustments[earlier]?.from ?? from);
    if (earlier >= 0) this.adjustments.splice(earlier, 1);
    if (first !== to) this.adjustments.push({ token: key, from: first, to, reason });
  }

  private clampForeground(key: string, surfaces: readonly string[], target: number, accept: (candidate: string) => boolean = () => true): void {
    const current = this.get(key);
    const values = surfaces.map((surface) => this.get(surface));
    const worst = lowest(current, values);
    if (worst >= target && accept(current)) return;
    const result = clampUntil(current, this.towards, (candidate) => lowest(candidate, values) >= target && accept(candidate));
    if (result.colour === undefined) return;
    const at = surfaces.find((surface) => ratio(current, this.get(surface)) === worst) ?? surfaces[0];
    this.set(key, result.colour, `${worst.toFixed(2)} to 1 on ${at}; target ${target}`);
  }

  private clampFill(key: string, awayFrom: string): void {
    const current = this.get(key);
    if (ratio(awayFrom, current) >= 4.5) return;
    const away = ratio(awayFrom, BLACK) > ratio(awayFrom, WHITE) ? BLACK : WHITE;
    const result = clampUntil(current, away, (candidate) => ratio(awayFrom, candidate) >= 4.5);
    if (result.colour !== undefined) this.set(key, result.colour, `${ratio(awayFrom, current).toFixed(2)} to 1 with accent.on; target 4.5`);
  }

  run(): void {
    for (const key of ['text.primary', 'text.secondary', 'text.tertiary']) this.clampForeground(key, TEXT_SURFACES, 4.5);
    this.clampForeground('text.link', CARRIER_SURFACES, 4.5);

    for (const key of FILL_TOKENS) this.clampFill(key, this.get('accent.on'));
    if (this.derived.has('accent.hover') || this.derived.has('accent.active')) {
      for (const [key, percent] of [['accent.hover', 8], ['accent.active', 16]] as const) {
        if (this.derived.has(key)) this.set(key, mix(this.get('accent'), BLACK, percent / 100), 'follows accent');
      }
    }

    this.clampForeground('accent.text', [...CARRIER_SURFACES, 'selection'], 3);
    this.fitSubtle();

    for (const status of STATUSES) {
      const content = this.get('surface.content');
      this.clampForeground(`${status}.fg`, STATUS_SURFACES, 4.5, (candidate) => ratio(candidate, mix(content, candidate, STATUS_BG_PERCENT / 100)) >= 4.5);
      this.set(`${status}.bg`, mix(content, this.get(`${status}.fg`), STATUS_BG_PERCENT / 100), 'follows the status colour');
    }
    if (this.derived.has('danger.fill')) this.set('danger.fill', this.get('danger.fg'), 'follows danger.fg');
    this.clampFill('danger.fill', this.get('accent.on'));

    this.clampForeground('focus.ring', [...TEXT_SURFACES, 'accent.subtle'], 3);
    this.clampForeground('border.strong', TEXT_SURFACES.slice(0, 6), 3);
    this.clampTooltip();
  }

  /** The tint of `accent.subtle` is lowered in 2 percent steps until the text colours and the accent text keep 4.5 to 1 on it. */
  private fitSubtle(): void {
    if (!this.derived.has('accent.subtle')) return;
    const content = this.get('surface.content');
    const readers = [this.get('accent.text'), this.get('text.primary'), this.get('text.secondary'), this.get('text.tertiary')];
    const start: number = this.dark ? SUBTLE_PERCENT.dark : SUBTLE_PERCENT.light;
    for (let percent = start; percent >= 0; percent -= 2) {
      const candidate = mix(content, this.get('accent.text'), percent / 100);
      if (readers.every((reader) => ratio(reader, candidate) >= 4.5) || percent === 0) {
        this.set('accent.subtle', candidate, 'tint lowered until text keeps 4.5 to 1');
        return;
      }
    }
  }

  private clampTooltip(): void {
    const background = this.get('tooltip.bg');
    const current = this.get('text.inverse');
    if (ratio(current, background) >= 4.5) return;
    const away = ratio(background, BLACK) > ratio(background, WHITE) ? BLACK : WHITE;
    const result = clampUntil(current, away, (candidate) => ratio(candidate, background) >= 4.5);
    if (result.colour !== undefined) this.set('text.inverse', result.colour, `${ratio(current, background).toFixed(2)} to 1 on tooltip.bg; target 4.5`);
  }
}

/** Token values copied for a check: the clamp edits its own copy. */
export const copyTokens = (tokens: TokenValues): Record<string, string> => ({ ...tokens });
