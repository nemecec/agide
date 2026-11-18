import { planLine } from '../agents/format';
import { useUsageState } from '../agents/useAgents';

/** Plan usage of the own profile in the rail: five-hour and seven-day windows and the forecast (0027 section 10). */
export function PlanUsage() {
  const usage = useUsageState();
  if (!usage) return null;
  const now = Date.parse(usage.now);
  if (usage.plan.length === 0) {
    return (
      <p className="plan-usage" data-testid="plan-usage" title="This login reports no plan windows yet; cost only.">
        no plan data
      </p>
    );
  }
  return (
    <ul className="plan-usage" data-testid="plan-usage" aria-label="Plan usage">
      {usage.plan.map((window) => (
        <li
          key={window.window}
          data-window={window.window}
          title={`percent of the ${window.window === 'five_hour' ? 'five-hour' : 'seven-day'} window, reported by Claude Code, as of ${window.observedAt}${window.runsOutInMinutes === undefined ? '' : '; forecast: estimate at the current rate'}`}
        >
          {planLine(window, now)}
        </li>
      ))}
    </ul>
  );
}
