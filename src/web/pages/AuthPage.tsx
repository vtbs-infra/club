import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useNavigate } from 'react-router-dom';

import { register, signIn } from '../api/identity';
import { ApiError } from '../api/http';
import { SiteHeader } from '../components/SiteHeader';

interface AuthFields {
  email: string;
  name: string;
  password: string;
}

interface AuthPageProperties {
  readonly mode: 'login' | 'register';
}

export function AuthPage({ mode }: AuthPageProperties) {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [registered, setRegistered] = useState(false);
  const { formState, handleSubmit, register: registerField } = useForm<AuthFields>();

  if (registered) return <Navigate replace state={{ registered: true }} to="/login" />;
  const isRegistration = mode === 'register';

  return (
    <main className="shell">
      <SiteHeader />
      <section className="auth-layout">
        <div className="auth-copy">
          <p className="section-kicker">SECURE WORKSPACE</p>
          <h1>{isRegistration ? 'Join your community team.' : 'Welcome back.'}</h1>
          <p className="lede">
            {isRegistration
              ? 'Create your Club identity. An owner can then invite you into an organization.'
              : 'Sign in to manage organizations, creators, and community gift operations.'}
          </p>
        </div>
        <form
          className="panel auth-form"
          onSubmit={handleSubmit(async (fields) => {
            setError(null);
            try {
              if (isRegistration) {
                await register(fields.email, fields.name, fields.password);
                setRegistered(true);
              } else {
                await signIn(fields.email, fields.password);
                await navigate('/organizations', { replace: true });
              }
            } catch (caught) {
              setError(caught instanceof ApiError ? caught.message : 'Unable to continue.');
            }
          })}
        >
          <div>
            <p className="panel-label">{isRegistration ? 'CREATE ACCOUNT' : 'SIGN IN'}</p>
            <h2>{isRegistration ? 'Your Club identity' : 'Continue to Club'}</h2>
          </div>
          {isRegistration ? (
            <label>
              Display name
              <input
                autoComplete="name"
                {...registerField('name', { required: 'Enter a display name.' })}
              />
              <span className="field-error">{formState.errors.name?.message}</span>
            </label>
          ) : null}
          <label>
            Email
            <input
              autoComplete="email"
              type="email"
              {...registerField('email', { required: 'Enter your email.' })}
            />
            <span className="field-error">{formState.errors.email?.message}</span>
          </label>
          <label>
            Password
            <input
              autoComplete={isRegistration ? 'new-password' : 'current-password'}
              minLength={8}
              type="password"
              {...registerField('password', {
                minLength: { message: 'Use at least 8 characters.', value: 8 },
                required: 'Enter your password.',
              })}
            />
            <span className="field-error">{formState.errors.password?.message}</span>
          </label>
          {error ? <div className="form-message form-error">{error}</div> : null}
          <button className="button" disabled={formState.isSubmitting} type="submit">
            {formState.isSubmitting ? 'Working…' : isRegistration ? 'Create account' : 'Sign in'}
          </button>
          <p className="form-switch">
            {isRegistration ? 'Already registered?' : 'New to Club?'}{' '}
            <Link to={isRegistration ? '/login' : '/register'}>
              {isRegistration ? 'Sign in' : 'Create an account'}
            </Link>
          </p>
        </form>
      </section>
    </main>
  );
}
