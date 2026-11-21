import { useState, type CSSProperties } from 'react';
import { api } from '../api';
import { Button, TextField } from '../ui/index';

/** Name and colour of a new profile, in the popover of the rail's plus tile. The creating process makes the profile and starts it. */
export function NewProfileForm({ palette, onDone }: { palette: readonly string[]; onDone: () => void }) {
  const [name, setName] = useState('');
  const [colour, setColour] = useState<string | undefined>(palette[0]);
  const [problem, setProblem] = useState<string | undefined>(undefined);

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    if (colour === undefined) return;
    void api()
      .invoke('profile_create', { name, colour })
      .then((result) => {
        if (result.ok) onDone();
        else setProblem(result.error.message);
      });
  };

  return (
    <form className="profile-form" data-testid="profile-form" onSubmit={submit}>
      <TextField label="Name" data-testid="profile-name" value={name} maxLength={40} autoFocus error={problem} onChange={(event) => setName(event.target.value)} />
      <div className="profile-colours" role="radiogroup" aria-label="Colour">
        {palette.map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={value === colour}
            aria-label={value}
            className="profile-colour"
            style={{ '--profile-swatch': value } as CSSProperties}
            onClick={() => setColour(value)}
          />
        ))}
      </div>
      <div className="profile-form-actions">
        <Button type="button" variant="quiet" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={name.trim() === '' || colour === undefined}>
          Create
        </Button>
      </div>
    </form>
  );
}
