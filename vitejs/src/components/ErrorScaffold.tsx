import type { MouseEventHandler } from 'react';

type ErrorVariant = 'not-found' | 'forbidden' | 'server-error' | 'boundary';

interface ErrorAction {
  label: string;
  href?: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
}

interface ErrorScaffoldProps {
  variant: ErrorVariant;
  code?: number | string;
  title?: string;
  message?: string;
  primaryAction?: ErrorAction;
  secondaryAction?: ErrorAction;
}

const DEFAULTS: Record<
  ErrorVariant,
  { code: string; title: string; message: string; primaryAction?: ErrorAction }
> = {
  'not-found': {
    code: '404',
    title: 'Page not found',
    message: 'The page you are looking for does not exist or has been moved.',
    primaryAction: { label: 'Go home', href: '/' },
  },
  forbidden: {
    code: '403',
    title: 'Access denied',
    message: 'You do not have permission to view this page.',
    primaryAction: { label: 'Go home', href: '/' },
  },
  'server-error': {
    code: '500',
    title: 'Unable to load',
    message: 'We had trouble loading this page. Please try again.',
  },
  boundary: {
    code: '500',
    title: 'Something went wrong',
    message: 'We had trouble loading this page. Please try again.',
  },
};

function renderAction(action: ErrorAction, variant: 'primary' | 'secondary') {
  const className = `error-scaffold__action error-scaffold__action--${variant}`;
  if (action.href) {
    return (
      <a className={className} href={action.href}>
        {action.label}
      </a>
    );
  }
  return (
    <button
      className={className}
      onClick={action.onClick}
      disabled={action.disabled}
    >
      {action.label}
    </button>
  );
}

export function ErrorScaffold({
  variant,
  code,
  title,
  message,
  primaryAction,
  secondaryAction,
}: ErrorScaffoldProps) {
  const defaults = DEFAULTS[variant];
  const resolvedPrimary = primaryAction ?? defaults.primaryAction;

  return (
    <div
      className={`full-page-state error-scaffold error-scaffold--${variant}`}
      role='alert'
    >
      <section
        className='error-scaffold__body'
        aria-labelledby='error-scaffold-title'
      >
        <div className='error-scaffold__code' aria-hidden='true'>
          {code ?? defaults.code}
        </div>
        <h2 id='error-scaffold-title'>{title ?? defaults.title}</h2>
        <p>{message ?? defaults.message}</p>
        {(resolvedPrimary || secondaryAction) && (
          <div className='error-scaffold__actions'>
            {resolvedPrimary && renderAction(resolvedPrimary, 'primary')}
            {secondaryAction && renderAction(secondaryAction, 'secondary')}
          </div>
        )}
      </section>
    </div>
  );
}
