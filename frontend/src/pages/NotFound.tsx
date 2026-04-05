import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <div className='full-page-state' role='alert'>
      <div>
        <h2
          style={{
            fontSize: 'var(--text-2xl)',
            color: 'var(--color-text-muted)',
          }}
        >
          404
        </h2>
        <h3>Page Not Found</h3>
        <p>The page you are looking for does not exist or has been moved.</p>
        <Link to='/'>Back to Dashboard</Link>
      </div>
    </div>
  );
}
