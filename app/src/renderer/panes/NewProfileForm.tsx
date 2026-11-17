import { useState } from 'react';
import { api } from '../api';

/** Name and colour of a new profile. The creating process makes the profile and starts it. */
export function NewProfileForm({ palette, onDone }: { palette: readonly string[]; onDone: () => void }) {
  const [name, setName] = useState('');
  const [colour, setColour] = useState(palette[0] ?? '#5b7fa6');
  const [problem, setProblem] = useState<string | undefined>(undefined);

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    void api()
      .invoke('profile_create', { name, colour })
      .then((result) => {
        if (result.ok) onDone();
        else setProblem(result.error.message);
      });
  };

  return (
    <form className="profile-form" data-testid="profile-form" onSubmit={submit}>
      <label>
        Name
        <input data-testid="profile-name" value={name} maxLength={40} autoFocus onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="profile-colours" role="radiogroup" aria-label="Colour">
        {palette.map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={value === colour}
            aria-label={value}
            className="profile-colour"
            style={{ background: value }}
            onClick={() => setColour(value)}
          />
        ))}
      </div>
      {problem ? <p role="alert">{problem}</p> : null}
      <div className="profile-form-actions">
        <button type="submit" disabled={name.trim() === ''}>
          Create
        </button>
        <button type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}
