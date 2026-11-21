/** "just now", "5 min ago", "3 h ago", "2 d ago". */
export function ageOf(iso: string, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

export const KIND_LABEL: Record<string, string> = {
  status: 'Update',
  input: 'Needs input',
  approval: 'Approval',
  review: 'Review',
  failure: 'Failure',
  reminder: 'Reminder',
  alert: 'Alert',
};

/** The next 09:00 local time after the instant. */
export function tomorrowMorning(now: Date = new Date()): Date {
  const next = new Date(now);
  next.setDate(next.getDate() + 1);
  next.setHours(9, 0, 0, 0);
  return next;
}

/** Raw tool input of an approval item, as plain text. */
export function payloadText(payload: unknown): string | undefined {
  if (payload === null || typeof payload !== 'object') return undefined;
  const input = (payload as { toolInput?: unknown }).toolInput;
  if (input === undefined) return undefined;
  return typeof input === 'string' ? input : JSON.stringify(input, null, 2);
}

/** An open approval waits for an answer in its session; reading the item does not answer it. */
export const needsAnswer = (item: { readonly kind: string; readonly state: string }): boolean => item.kind === 'approval' && (item.state === 'new' || item.state === 'seen');

const URGENCY_RANK: Record<string, number> = { low: 0, normal: 1, high: 2 };

/**
 * The order of the list: items that need an answer first, then by urgency, then newest first by creation time.
 * Reading, un-reading or snoozing an item does not move it. Items equal in all three keep the order they came in.
 */
export function orderItems<T extends { readonly kind: string; readonly state: string; readonly urgency: string; readonly createdAt: string }>(items: readonly T[]): T[] {
  return [...items].sort(
    (a, b) =>
      Number(needsAnswer(b)) - Number(needsAnswer(a)) ||
      (URGENCY_RANK[b.urgency] ?? 1) - (URGENCY_RANK[a.urgency] ?? 1) ||
      b.createdAt.localeCompare(a.createdAt),
  );
}

/** True when the text is a JSON object or array, which the card shows as code on an inset surface. */
export function isStructuredText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false;
  try {
    return typeof JSON.parse(trimmed) === 'object';
  } catch {
    return false;
  }
}
