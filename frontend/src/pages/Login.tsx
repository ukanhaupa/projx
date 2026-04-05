import { useState } from 'react';
import { login } from '../auth';
import { useTheme } from '../theme';

export function Login({ onAuth }: { onAuth: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { theme, toggle } = useTheme();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
      onAuth();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className='login-page'>
      <button
        className='theme-toggle'
        onClick={toggle}
        aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
      >
        {theme === 'light' ? '\u263E' : '\u2600'}
      </button>
      <form
        className='login-form'
        onSubmit={handleSubmit}
        noValidate
        aria-label='Login form'
      >
        <h2>Sign In</h2>
        {error && (
          <div className='error' role='alert'>
            {error}
          </div>
        )}
        <label htmlFor='login-username'>
          Username
          <input
            id='login-username'
            type='text'
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            autoComplete='username'
            autoFocus
          />
        </label>
        <label htmlFor='login-password'>
          Password
          <div className='password-wrapper'>
            <input
              id='login-password'
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete='current-password'
            />
            <button
              type='button'
              className='password-toggle'
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              <svg
                width='20'
                height='20'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                strokeWidth='2'
                strokeLinecap='round'
                strokeLinejoin='round'
                aria-hidden='true'
              >
                {showPassword ? (
                  <>
                    <path d='M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94' />
                    <path d='M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19' />
                    <line x1='1' y1='1' x2='23' y2='23' />
                  </>
                ) : (
                  <>
                    <path d='M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z' />
                    <circle cx='12' cy='12' r='3' />
                  </>
                )}
              </svg>
            </button>
          </div>
        </label>
        <button type='submit' disabled={loading}>
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>
    </div>
  );
}
