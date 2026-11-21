import { planLine } from '../panes/agents/format';
import { useUsageState } from '../panes/agents/useAgents';
import { Icon, Tooltip } from '../ui/index';
import { PANE_ICONS } from '../ui/icons';
import { meterText, meterWindow } from './meterModel';
import './UsageMeter.css';

/** Plan usage of the own profile in the title bar. The tooltip lists every window the login reports and says the forecast is an estimate. */
export function UsageMeter() {
  const usage = useUsageState();
  if (!usage) return null;
  const now = Date.parse(usage.now);
  const shown = meterWindow(usage.plan);
  const lines = usage.plan.map((window) => planLine(window, now));
  const text = shown ? meterText(shown, now) : 'no plan data';
  return (
    <Tooltip
      content={
        lines.length === 0 ? (
          'This login reports no plan windows yet; cost only.'
        ) : (
          <>
            {lines.map((line) => (
              <div key={line}>{line}</div>
            ))}
            <div>Percent of the window as reported by Claude Code; a forecast is an estimate at the current rate.</div>
          </>
        )
      }
    >
      <span className="usage-meter" data-testid="usage-meter" role="group" aria-label={lines.length === 0 ? 'Plan usage: no plan data' : `Plan usage: ${lines.join('; ')}`} tabIndex={0}>
        <Icon icon={PANE_ICONS.usage.icon} size="md" />
        <span>{text}</span>
      </span>
    </Tooltip>
  );
}
