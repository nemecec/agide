import type { Severity, StoredFinding } from '../../../core/review/schemas';
import { Chip } from '../../ui/Chip';
import type { Tone } from '../../ui/icons';
import { plainText } from './plainText';

const SEVERITY_TONES: Readonly<Record<Severity, Tone>> = { blocker: 'danger', major: 'danger', minor: 'warning', nit: 'neutral' };

/** One reviewer finding. Title and body are written by the reviewer agent, so they show as escaped plain text. */
export function FindingView({ finding, author = 'the reviewer agent' }: { readonly finding: StoredFinding; readonly author?: string }) {
  return (
    <div className="review-finding" data-testid="review-finding" data-severity={finding.severity}>
      <div className="review-finding-head">
        <Chip tone={SEVERITY_TONES[finding.severity]} label={finding.severity} />
        <span className="review-finding-title">{plainText(finding.title)}</span>
        {!finding.onChangedLine && <span className="review-muted">on an unchanged line</span>}
      </div>
      {finding.body !== '' && <p className="review-finding-body">{plainText(finding.body, { multiline: true })}</p>}
      <p className="review-muted">Text written by {author}</p>
    </div>
  );
}
