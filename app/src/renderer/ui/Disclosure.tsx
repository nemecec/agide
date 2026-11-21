import { useId, useState, type ReactNode } from 'react';
import { cx } from './cx';
import { Icon } from './Icon';
import { CONTROL_ICONS } from './icons';
import './Disclosure.css';

export interface DisclosureProps {
  readonly label: ReactNode;
  readonly open?: boolean;
  readonly defaultOpen?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly className?: string;
  readonly 'data-testid'?: string;
  readonly children: ReactNode;
}

/** A button with `aria-expanded` over a region. It replaces the native `<details>` marker. The region stays mounted while closed. */
export function Disclosure({ label, open, defaultOpen = false, onOpenChange, className, 'data-testid': testId, children }: DisclosureProps) {
  const [own, setOwn] = useState(defaultOpen);
  const shown = open ?? own;
  const regionId = useId();
  const toggle = (): void => {
    if (open === undefined) setOwn(!shown);
    onOpenChange?.(!shown);
  };
  return (
    <div className={cx('ui-disclosure', className)} data-open={shown || undefined} data-testid={testId}>
      <button type="button" className="ui-disclosure-button" aria-expanded={shown} aria-controls={regionId} onClick={toggle}>
        <Icon icon={CONTROL_ICONS.disclosure} size="xs" className="ui-disclosure-chevron" />
        {label}
      </button>
      <div id={regionId} role="region" hidden={!shown} className="ui-disclosure-region">
        {children}
      </div>
    </div>
  );
}
