import type { ComponentProps, ReactNode } from 'react';
import { cx } from './cx';
import './Card.css';

export interface CardProps extends Omit<ComponentProps<'section'>, 'title'> {
  readonly title?: ReactNode;
  readonly meta?: ReactNode;
  /** The action row below the body. */
  readonly actions?: ReactNode;
}

/** A raised section: header with title and meta line, body, action row. */
export function Card({ title, meta, actions, className, children, ...rest }: CardProps) {
  return (
    <section {...rest} className={cx('ui-card', className)}>
      {title !== undefined || meta !== undefined ? (
        <header className="ui-card-header">
          {title !== undefined ? <h3 className="ui-card-title">{title}</h3> : null}
          {meta !== undefined ? <p className="ui-card-meta">{meta}</p> : null}
        </header>
      ) : null}
      <div className="ui-card-body">{children}</div>
      {actions ? <div className="ui-card-actions">{actions}</div> : null}
    </section>
  );
}
