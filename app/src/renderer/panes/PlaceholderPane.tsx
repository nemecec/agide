/** `agide/placeholder`: what an instance shows when its pane type is missing, disabled or out of range. The config stays in the layout. */
export function PlaceholderPane({ type, reason, message }: { type: string; reason: string; message: string }) {
  return (
    <div className="placeholder-pane" data-testid="placeholder-pane" role="note">
      <strong>{type}</strong>
      <div>{message}</div>
      <div className="muted">Reason: {reason}. The instance and its config stay in the layout file.</div>
    </div>
  );
}
