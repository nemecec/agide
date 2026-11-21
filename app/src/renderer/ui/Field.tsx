import { useId, type InputHTMLAttributes, type ReactNode, type Ref, type TextareaHTMLAttributes } from 'react';
import { cx } from './cx';
import { Icon } from './Icon';
import { CONTROL_ICONS } from './icons';
import './Field.css';

/** What a control receives from its Field: its id and the links to the help or error line. */
export interface ControlProps {
  readonly id: string;
  readonly 'aria-invalid'?: true;
  readonly 'aria-describedby'?: string;
}

export interface FieldProps {
  readonly label: ReactNode;
  readonly help?: ReactNode;
  /** An error replaces the help line and marks the control invalid. */
  readonly error?: ReactNode;
  readonly className?: string | undefined;
  readonly children: (control: ControlProps) => ReactNode;
}

/** A label above a control, with a help or error line below. The error starts with an icon, so it does not depend on colour. */
export function Field({ label, help, error, className, children }: FieldProps) {
  const id = useId();
  const noteId = `${id}-note`;
  const hasError = error !== undefined && error !== null && error !== false;
  const hasHelp = !hasError && help !== undefined && help !== null && help !== false;
  const control: ControlProps = { id, ...(hasError ? { 'aria-invalid': true as const } : {}), ...(hasError || hasHelp ? { 'aria-describedby': noteId } : {}) };
  return (
    <div className={cx('ui-field', className)}>
      <label className="ui-field-label" htmlFor={id}>
        {label}
      </label>
      {children(control)}
      {hasError ? (
        <p id={noteId} className="ui-field-note" data-kind="error">
          <Icon icon={CONTROL_ICONS.invalid} size="xs" />
          {error}
        </p>
      ) : null}
      {hasHelp ? (
        <p id={noteId} className="ui-field-note">
          {help}
        </p>
      ) : null}
    </div>
  );
}

interface TextFieldBase {
  readonly label: ReactNode;
  readonly help?: ReactNode;
  readonly error?: ReactNode;
  /** Draws the value in the mono step, for paths and ids. */
  readonly mono?: boolean;
  readonly fieldClassName?: string | undefined;
}

export type TextFieldProps = TextFieldBase & Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'className'> & { readonly className?: string | undefined; readonly ref?: Ref<HTMLInputElement> };

export function TextField({ label, help, error, mono = false, fieldClassName, className, ref, ...input }: TextFieldProps) {
  return (
    <Field label={label} help={help} error={error} className={fieldClassName}>
      {(control) => <input {...input} {...control} ref={ref} className={cx('ui-input', className)} data-mono={mono || undefined} />}
    </Field>
  );
}

export type TextAreaProps = TextFieldBase & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id' | 'className'> & { readonly className?: string | undefined; readonly ref?: Ref<HTMLTextAreaElement> };

export function TextArea({ label, help, error, mono = false, fieldClassName, className, rows = 3, ref, ...input }: TextAreaProps) {
  return (
    <Field label={label} help={help} error={error} className={fieldClassName}>
      {(control) => <textarea {...input} {...control} ref={ref} rows={rows} className={cx('ui-input ui-textarea', className)} data-mono={mono || undefined} />}
    </Field>
  );
}
