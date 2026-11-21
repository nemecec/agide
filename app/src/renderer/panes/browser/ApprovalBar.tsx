import { api } from '../../api';
import { Banner } from '../../ui/Banner';
import { Button } from '../../ui/Button';
import { SURFACE_ICONS } from '../../ui/icons';
import { Menu } from '../../ui/Menu';
import type { MenuEntry } from '../../ui/menuModel';
import type { BrowserApproval } from './model';

/** The permission request of an agent, drawn in the tab chrome outside the page view so a page cannot imitate it. */
export function ApprovalBar({ approval, onAnswered }: { readonly approval: BrowserApproval; readonly onAnswered: () => void }) {
  const answer = (value: 'deny' | 'once' | 'session' | 'always'): void => {
    void api()
      .invoke('browser_answer_approval', { id: approval.id, answer: value })
      .then(onAnswered);
  };
  const who = approval.sessionTitle ? (
    <>
      The session <strong>{approval.sessionTitle}</strong>
    </>
  ) : (
    'An agent'
  );
  const more: MenuEntry[] = [
    { label: 'Allow for this session', run: () => answer('session') },
    ...(approval.service === 'web' ? [{ label: 'Always allow this site', run: () => answer('always') }] : []),
  ];
  return (
    <Banner
      tone="warning"
      icon={SURFACE_ICONS.agent.icon}
      aria-label="Agent permission request"
      data-testid="approval-bar"
      message={
        <>
          {who} asks to {approval.kind === 'navigate' ? 'open' : 'act on'}{' '}
          <code>{approval.origin}</code>
          {approval.object !== undefined && <> ({approval.object})</>}
          {approval.kind === 'act' && (
            <>
              : {approval.tool}, {approval.summary}
            </>
          )}
        </>
      }
      actions={
        <>
          <Button size="sm" onClick={() => answer('deny')}>
            Deny
          </Button>
          <Button size="sm" variant="primary" onClick={() => answer('once')}>
            Allow once
          </Button>
          <Menu align="end" entries={more} trigger={<Button size="sm" chevron aria-label="More answers">More</Button>} />
        </>
      }
    />
  );
}
