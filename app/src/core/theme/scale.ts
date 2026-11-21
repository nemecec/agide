import { cssName } from './tokens';

export type Density = 'compact' | 'regular' | 'comfortable';
export const DENSITIES: readonly Density[] = ['compact', 'regular', 'comfortable'];

/** Defaults of the tokens that are not colours: radii, spacing, stacking, icons, motion, type weights. */
export const SCALE_DEFAULTS: Readonly<Record<string, string>> = {
  'radius.xs': '3px',
  'radius.sm': '4px',
  'radius.md': '6px',
  'radius.lg': '8px',
  'radius.xl': '12px',
  'radius.full': '999px',
  'space.0': '0',
  'space.0_5': '2px',
  'space.1': '4px',
  'space.1_5': '6px',
  'space.2': '8px',
  'space.2_5': '10px',
  'space.3': '12px',
  'space.4': '16px',
  'space.5': '20px',
  'space.6': '24px',
  'space.8': '32px',
  'z.dock-overlay': '10',
  'z.pane-chrome': '20',
  'z.popover': '40',
  'z.menu': '50',
  'z.dialog': '60',
  'z.tooltip': '70',
  'z.capture-mask': '100',
  'font.weight.regular': '400',
  'font.weight.medium': '500',
  'font.weight.semibold': '600',
  'font.numeric': 'tabular-nums',
  'icon.xs': '12px',
  'icon.sm': '14px',
  'icon.md': '16px',
  'icon.lg': '20px',
  'icon.xl': '32px',
  'motion.fast': '100ms',
  'motion.base': '160ms',
  'motion.slow': '240ms',
  'ease.standard': 'cubic-bezier(0.2, 0, 0, 1)',
  'ease.enter': 'cubic-bezier(0, 0, 0.2, 1)',
  'ease.exit': 'cubic-bezier(0.4, 0, 1, 1)',
  'focus.width': '2px',
};

/** Icon stroke widths by size, section 1.5. */
export const ICON_STROKE: Readonly<Record<string, number>> = { xs: 2, sm: 1.75, md: 1.5, lg: 1.5, xl: 1.25 };

interface TypeStep {
  readonly size: number;
  readonly line: number;
  readonly weight: string;
}

/** Section 1.4. The weight is a token name. */
export const TYPE_STEPS: Readonly<Record<string, TypeStep>> = {
  caption: { size: 11, line: 14, weight: 'regular' },
  small: { size: 12, line: 16, weight: 'regular' },
  body: { size: 13, line: 18, weight: 'regular' },
  'body-strong': { size: 13, line: 18, weight: 'semibold' },
  title: { size: 15, line: 20, weight: 'semibold' },
  large: { size: 20, line: 26, weight: 'semibold' },
  mono: { size: 12, line: 16, weight: 'regular' },
};

/** Section 1.6, compact, regular and comfortable in pixels. */
const DENSITY_HEIGHTS: Readonly<Record<string, readonly [number, number, number]>> = {
  row: [22, 24, 28],
  control: [22, 26, 28],
  'control-sm': [20, 22, 24],
  tab: [28, 30, 34],
  toolbar: [30, 34, 38],
  pad: [8, 12, 14],
};

/** The CSS variables of the type steps and of one density. */
export function typeAndDensityVariables(density: Density): Record<string, string> {
  const variables: Record<string, string> = {};
  for (const [name, step] of Object.entries(TYPE_STEPS)) {
    variables[cssName(`type.${name}.size`)] = `${step.size}px`;
    variables[cssName(`type.${name}.line`)] = `${step.line}px`;
    variables[cssName(`type.${name}.weight`)] = `var(${cssName(`font.weight.${step.weight}`)})`;
  }
  const index = DENSITIES.indexOf(density);
  for (const [name, heights] of Object.entries(DENSITY_HEIGHTS)) variables[cssName(`density.${name}`)] = `${heights[index] ?? heights[1]}px`;
  variables[cssName('density.titlebar')] = '38px';
  return variables;
}
