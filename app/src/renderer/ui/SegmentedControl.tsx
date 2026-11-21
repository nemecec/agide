import { ToggleGroup as Primitive } from 'radix-ui';
import { cx } from './cx';
import './SegmentedControl.css';

export interface Segment {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
  readonly testId?: string;
}

export interface SegmentedControlProps {
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly segments: readonly Segment[];
  readonly 'aria-label': string;
  readonly className?: string;
}

/** A track of short options with one selected. Pressing the selected segment keeps it selected. */
export function SegmentedControl({ value, onValueChange, segments, 'aria-label': ariaLabel, className }: SegmentedControlProps) {
  return (
    <Primitive.Root
      type="single"
      className={cx('ui-segmented', className)}
      value={value}
      aria-label={ariaLabel}
      onValueChange={(next) => {
        if (next !== '') onValueChange(next);
      }}
    >
      {segments.map((segment) => (
        <Primitive.Item key={segment.value} value={segment.value} disabled={segment.disabled} className="ui-segment" data-testid={segment.testId}>
          {segment.label}
        </Primitive.Item>
      ))}
    </Primitive.Root>
  );
}
