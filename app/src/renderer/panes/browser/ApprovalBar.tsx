import { api } from '../../api';
import type { BrowserApproval } from './model';

/** The permission request of an agent, drawn in the tab chrome outside the page view so a page cannot imitate it. */
export function ApprovalBar({ approval, onAnswered }: { readonly approval: BrowserApproval; readonly onAnswered: () => void }) {
  const answer = (value: 'deny' | 'once' | 'session' | 'always'): void => {
    void api()
      .invoke('browser_answer_approval', { id: approval.id, answer: value })
      .then(onAnswered);
  };
  const who = approval.sessionTitle ? `The session "${approval.sessionTitle}"` : 'An agent';
  return (
    <div className="approval-bar" role="alertdialog" aria-label="Agent permission request" data-testid="approval-bar">
      <div>
        <strong>
          {who} asks to {approval.kind === 'navigate' ? 'open' : 'act on'}
        </strong>{' '}
        <code>{approval.origin}</code>
        {approval.object !== undefined && <> ({approval.object})</>}
        {approval.kind === 'act' && (
          <>
            : {approval.tool}, {approval.summary}
          </>
        )}
      </div>
      <div className="approval-buttons">
        <button type="button" className="btn-primary" onClick={() => answer('once')}>
          Allow once
        </button>
        <button type="button" onClick={() => answer('session')}>
          Allow for this session
        </button>
        <button type="button" onClick={() => answer('deny')}>
          Deny
        </button>
        {approval.service === 'web' && (
          <details className="approval-more">
            <summary>More</summary>
            <button type="button" title="Every agent may act on this site in every session until you remove it" onClick={() => answer('always')}>
              Always allow this site
            </button>
          </details>
        )}
      </div>
    </div>
  );
}
