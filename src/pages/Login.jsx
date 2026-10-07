import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../store.jsx';
import { GOOGLE_WEB_CLIENT_ID, forgotPassword, verifyResetOtp, resetPassword } from '../api.js';
import { EyeIcon, EyeOffIcon } from '../icons.jsx';
import { validateLogin, validateSignup } from '../validate.js';

// Real auth against api.ardena.xyz — same accounts as the client0 app.

const GSI_SRC = 'https://accounts.google.com/gsi/client';
let gsiPromise = null;

function loadGsi() {
  if (window.google && window.google.accounts && window.google.accounts.id) {
    return Promise.resolve();
  }
  if (!gsiPromise) {
    gsiPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${GSI_SRC}"]`);
      const s = existing || document.createElement('script');
      s.addEventListener('load', resolve, { once: true });
      s.addEventListener('error', () => reject(new Error('Google script failed to load')), {
        once: true,
      });
      if (!existing) {
        s.src = GSI_SRC;
        s.async = true;
        document.head.appendChild(s);
      }
    });
  }
  return gsiPromise;
}

/** "Continue with Google" via Google Identity Services. The backend takes the
 * ID token at POST /client/auth/google, so we render the official GIS button
 * (the ID-token flow requires it — custom buttons only get OAuth access tokens). */
export function GoogleButton({ onSignedIn, onError }) {
  const { signInWithGoogle } = useApp();
  const slotRef = useRef(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadGsi()
      .then(() => {
        if (cancelled || !slotRef.current) return;
        window.google.accounts.id.initialize({
          client_id: GOOGLE_WEB_CLIENT_ID,
          callback: async ({ credential }) => {
            try {
              await signInWithGoogle(credential);
              onSignedIn();
            } catch (e) {
              onError(e.message || 'Google sign-in failed. Please try again.');
            }
          },
        });
        const width = Math.min(400, slotRef.current.clientWidth || 400);
        window.google.accounts.id.renderButton(slotRef.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          shape: 'pill',
          text: 'continue_with',
          logo_alignment: 'center',
          width,
        });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) {
    return <p className="gsi-unavailable">Google sign-in is unavailable right now.</p>;
  }
  return <div className="gsi-slot" ref={slotRef} />;
}

function FormError({ children }) {
  if (!children) return null;
  return (
    <div style={{ color: 'var(--error)', fontSize: 'var(--fs-sm)', fontWeight: 700, marginTop: 10 }}>
      {children}
    </div>
  );
}

/** Per-field validation message shown directly under its input. */
export function FieldError({ children }) {
  if (!children) return null;
  return <span className="field-error">{children}</span>;
}

export function PasswordInput({ value, onChange, placeholder = '••••••••', error }) {
  const [show, setShow] = useState(false);
  return (
    <div className={`control${error ? ' err' : ''}`}>
      <input
        type={show ? 'text' : 'password'}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        required
      />
      <button
        type="button"
        className="eye-btn"
        aria-label={show ? 'Hide password' : 'Show password'}
        onClick={() => setShow((s) => !s)}
      >
        {show ? <EyeOffIcon size={18} /> : <EyeIcon size={18} />}
      </button>
    </div>
  );
}

export default function Login() {
  const { signInWithPassword } = useApp();
  const navigate = useNavigate();
  const { state } = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const clearErr = (k) => setErrors((x) => (x[k] ? { ...x, [k]: undefined } : x));
  const goNext = () => navigate(state?.next || '/', { replace: true });

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    const errs = validateLogin({ email, password });
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setError('');
    setBusy(true);
    try {
      await signInWithPassword(email.trim(), password);
      goNext();
    } catch (err) {
      setError(err.message || 'Unable to log in. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page" style={{ padding: '20px 0 40px' }}>
      <div className="container" style={{ maxWidth: 500 }}>
        <h1 className="page-title" style={{ textAlign: 'center', marginBottom: 20 }}>
          Log in
        </h1>
        <form className="form-card auth-card" onSubmit={submit} noValidate>
          <div className="field">
            <label>Email</label>
            <div className={`control${errors.email ? ' err' : ''}`}>
              <input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  clearErr('email');
                }}
                autoComplete="email"
              />
            </div>
            <FieldError>{errors.email}</FieldError>
          </div>
          <div className="field">
            <label>Password</label>
            <PasswordInput
              value={password}
              error={errors.password}
              onChange={(e) => {
                setPassword(e.target.value);
                clearErr('password');
              }}
            />
            <FieldError>{errors.password}</FieldError>
          </div>
          <FormError>{error}</FormError>
          <button
            type="submit"
            className="btn-primary btn-block"
            style={{ marginTop: 'var(--sp-1)' }}
            disabled={busy}
          >
            {busy ? 'Logging in…' : 'Log in'}
          </button>
          <div className="auth-divider">or</div>
          <GoogleButton onSignedIn={goNext} onError={setError} />
          <div className="auth-links stack">
            <Link to="/forgot" className="link">
              Forgot password?
            </Link>
            <span>
              New here?{' '}
              <Link to="/signup" className="link">
                Sign up
              </Link>
            </span>
          </div>
        </form>
      </div>
    </div>
  );
}

export function Signup() {
  const { signUp } = useApp();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const clearErr = (k) => setErrors((x) => (x[k] ? { ...x, [k]: undefined } : x));
  const goHome = () => navigate('/', { replace: true });

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    const errs = validateSignup({ name, email, password, confirm });
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setError('');
    setBusy(true);
    try {
      await signUp({
        fullName: name.trim(),
        email: email.trim(),
        password,
        passwordConfirmation: confirm,
      });
      goHome();
    } catch (err) {
      setError(err.message || 'Unable to create your account. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="container" style={{ maxWidth: 420 }}>
        <h1 className="page-title" style={{ textAlign: 'center', marginBottom: 26 }}>
          Create your account
        </h1>
        <form className="form-card" onSubmit={submit} noValidate>
          <div className="field">
            <label>Full name</label>
            <div className={`control${errors.name ? ' err' : ''}`}>
              <input
                type="text"
                placeholder="Jane Wanjiku"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  clearErr('name');
                }}
                autoComplete="name"
              />
            </div>
            <FieldError>{errors.name}</FieldError>
          </div>
          <div className="field">
            <label>Email</label>
            <div className={`control${errors.email ? ' err' : ''}`}>
              <input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  clearErr('email');
                }}
                autoComplete="email"
              />
            </div>
            <FieldError>{errors.email}</FieldError>
          </div>
          <div className="field">
            <label>Password</label>
            <PasswordInput
              placeholder="At least 8 characters"
              value={password}
              error={errors.password}
              onChange={(e) => {
                setPassword(e.target.value);
                clearErr('password');
              }}
            />
            <FieldError>{errors.password}</FieldError>
          </div>
          <div className="field">
            <label>Confirm password</label>
            <PasswordInput
              placeholder="Repeat your password"
              value={confirm}
              error={errors.confirm}
              onChange={(e) => {
                setConfirm(e.target.value);
                clearErr('confirm');
              }}
            />
            <FieldError>{errors.confirm}</FieldError>
          </div>
          <FormError>{error}</FormError>
          <button
            type="submit"
            className="btn-primary btn-block"
            style={{ marginTop: 'var(--sp-1)' }}
            disabled={busy}
          >
            {busy ? 'Creating account…' : 'Sign up'}
          </button>
          <div className="auth-divider">or</div>
          <GoogleButton onSignedIn={goHome} onError={setError} />
          <div className="auth-links stack">
            <span>
              Already have an account?{' '}
              <Link to="/login" className="link">
                Log in
              </Link>
            </span>
          </div>
        </form>
      </div>
    </div>
  );
}

export function Forgot() {
  // Real 3-step flow (API.md): forgot-password sends a 6-digit OTP,
  // verify-reset-otp checks it, reset-password sets the new one.
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setError('');

    if (step === 2 && otp.trim().length !== 6) {
      setError('Enter the 6-digit code from your email.');
      return;
    }
    if (step === 3) {
      if (password.length < 8) {
        setError('Password must be at least 8 characters.');
        return;
      }
      if (password !== confirm) {
        setError('Passwords don’t match.');
        return;
      }
    }

    setBusy(true);
    try {
      if (step === 1) {
        await forgotPassword(email.trim());
        setStep(2);
      } else if (step === 2) {
        await verifyResetOtp(email.trim(), otp.trim());
        setStep(3);
      } else if (step === 3) {
        await resetPassword(email.trim(), otp.trim(), password);
        setStep(4);
      }
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page" style={{ padding: '20px 0 40px' }}>
      <div className="container" style={{ maxWidth: 500 }}>
        <h1 className="page-title" style={{ textAlign: 'center', marginBottom: 20 }}>
          Reset password
        </h1>
        {step === 4 ? (
          <div className="form-card auth-card" style={{ textAlign: 'center' }}>
            <p style={{ color: 'var(--text-2)' }}>
              Your password has been reset. Log in with your new password.
            </p>
            <Link to="/login" className="btn-primary btn-block" style={{ marginTop: 22 }}>
              Back to log in
            </Link>
          </div>
        ) : (
          <form className="form-card auth-card" onSubmit={submit}>
            {step === 1 && (
              <>
                <div className="field">
                  <label>Email</label>
                  <div className="control">
                    <input
                      type="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                </div>
                <FormError>{error}</FormError>
                <button
                  type="submit"
                  className="btn-primary btn-block"
                  style={{ marginTop: 'var(--sp-1)' }}
                  disabled={busy}
                >
                  {busy ? 'Sending…' : 'Send code'}
                </button>
              </>
            )}

            {step === 2 && (
              <>
                <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', marginBottom: 18 }}>
                  We sent a 6-digit code to <b>{email}</b>. It expires in 5 minutes.
                </p>
                <div className="field">
                  <label>Verification code</label>
                  <div className="control">
                    <input
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="123456"
                      value={otp}
                      onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                      required
                      style={{ letterSpacing: 6, fontWeight: 700 }}
                    />
                  </div>
                </div>
                <FormError>{error}</FormError>
                <button
                  type="submit"
                  className="btn-primary btn-block"
                  style={{ marginTop: 'var(--sp-1)' }}
                  disabled={busy}
                >
                  {busy ? 'Verifying…' : 'Verify code'}
                </button>
              </>
            )}

            {step === 3 && (
              <>
                <div className="field">
                  <label>New password</label>
                  <PasswordInput
                    placeholder="At least 8 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label>Confirm new password</label>
                  <PasswordInput
                    placeholder="Repeat your password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                </div>
                <FormError>{error}</FormError>
                <button
                  type="submit"
                  className="btn-primary btn-block"
                  style={{ marginTop: 'var(--sp-1)' }}
                  disabled={busy}
                >
                  {busy ? 'Resetting…' : 'Reset password'}
                </button>
              </>
            )}

            <div className="auth-links stack">
              <Link to="/login" className="link">
                Back to log in
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
