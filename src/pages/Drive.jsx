import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../store.jsx';
import * as api from '../api.js';
import { isEmail } from '../validate.js';
import { GoogleButton, PasswordInput, FieldError } from './Login.jsx';
import PinMap from '../PinMap.jsx';
import appstoreImg from '../assets/appstore.png';
import playImg from '../assets/play.png';
import {
  CheckIcon,
  ClockIcon,
  IdCardIcon,
  MapPinIcon,
  PlusIcon,
  SteeringIcon,
  UserIcon,
  XIcon,
  CarIcon,
  CreditCardIcon,
} from '../icons.jsx';

// "Drive with Ardena": apply to be a chauffeur, signed in or not. Guests make
// their account as the first step of the form (approved drivers work from the
// app's Chauffeur Mode with it). Contract: POST /chauffeur/documents,
// POST /chauffeur/application, GET /chauffeur/application(/prefill).

const DRAFT_KEY = 'ardena.web.driveDraft';
const APP_STORE_URL = 'https://apps.apple.com/app/ardena/id6772513965';
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.ardena.client';

const CAR_TYPES = ['Saloon', 'SUV', 'Pickup', 'Van / Minibus', 'Luxury', 'Electric'];
const TRANSMISSIONS = ['Automatic', 'Manual'];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const LANGUAGE_SUGGESTIONS = ['English', 'Swahili', 'Kikuyu', 'Luo', 'Kalenjin', 'Luhya', 'Kamba'];
const KE_MOBILE = /^(?:\+?254|0)?[17]\d{8}$/;
const MAX_UPLOAD = 10 * 1024 * 1024;
const UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const STEPS = [
  { key: 'account', title: 'Your account', icon: UserIcon, fields: [] },
  {
    key: 'about',
    title: 'About you',
    icon: UserIcon,
    fields: ['first_name', 'last_name', 'phone', 'photo', 'years_experience', 'languages', 'bio'],
  },
  {
    key: 'licence',
    title: 'Licence & ID',
    icon: IdCardIcon,
    fields: ['licence_number', 'licence_photo', 'id_photo', 'good_conduct_photo'],
  },
  {
    key: 'where',
    title: 'Where you drive',
    icon: MapPinIcon,
    fields: ['base_town', 'areas_served', 'nationwide', 'base_lat', 'base_lng'],
  },
  {
    key: 'cars',
    title: 'Cars & hours',
    icon: CarIcon,
    fields: ['car_types', 'transmissions', 'vehicle_types', 'service_type', 'days', 'start', 'end'],
  },
  {
    key: 'rates',
    title: 'Rates & references',
    icon: CreditCardIcon,
    fields: ['price_per_day', 'price_per_hour', 'references', 'agreed'],
  },
];

const EMPTY_FORM = {
  first_name: '',
  last_name: '',
  phone: '',
  years_experience: '',
  languages: ['English', 'Swahili'],
  bio: '',
  licence_number: '',
  base_town: '',
  areas_served: [],
  nationwide: false,
  base_lat: null,
  base_lng: null,
  car_types: [],
  transmissions: ['Automatic'],
  service_type: 'driver_only',
  days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
  start: '07:00',
  end: '19:00',
  price_per_day: '',
  price_per_hour: '',
  references: [{ name: '', phone: '' }],
  agreed: false,
};

/** Form fields only: never files, upload links or tokens. */
function loadDraft() {
  try {
    const d = JSON.parse(sessionStorage.getItem(DRAFT_KEY));
    return d && d.form ? { form: { ...EMPTY_FORM, ...d.form }, step: d.step || 0 } : null;
  } catch {
    return null;
  }
}

function saveDraft(form, step) {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ form, step }));
  } catch {
    /* storage unavailable: the form still works, it just won't survive a reload */
  }
}

function clearDraft() {
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    /* nothing to clear */
  }
}

const stepOfField = (field) => STEPS.findIndex((s) => s.fields.includes(field));

/** Which step a server error belongs to: the 422 field when there is one, else by wording. */
function stepForError(err) {
  const d = err?.data?.detail;
  if (Array.isArray(d) && d.length && Array.isArray(d[0].loc)) {
    for (const part of [...d[0].loc].reverse()) {
      const i = stepOfField(String(part));
      if (i > 0) return i;
    }
  }
  const m = String(err?.message || '').toLowerCase();
  if (/licence|license/.test(m)) return 2;
  if (/\bid photo|good conduct/.test(m)) return 2;
  if (/profile photo|photo of you|\bphoto\b/.test(m)) return 1;
  if (/reference/.test(m)) return 5;
  if (/rate|price|agree|terms/.test(m)) return 5;
  if (/working hours|days|car type|transmission/.test(m)) return 4;
  if (/town|area|base_lat|location/.test(m)) return 3;
  if (/phone|mobile|name|language|experience/.test(m)) return 1;
  return -1;
}

function splitName(full) {
  const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] || '', last: parts.slice(1).join(' ') };
}

function fmtDay(iso) {
  if (!iso) return '';
  return new Date(String(iso).length <= 10 ? `${iso}T00:00:00` : iso).toLocaleDateString('en-KE', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

// ---------- small inputs ----------

function TagInput({ values, onChange, placeholder, suggestions = [], max = 30 }) {
  const [text, setText] = useState('');
  const add = (raw) => {
    const v = String(raw || '').trim();
    if (!v || values.some((x) => x.toLowerCase() === v.toLowerCase()) || values.length >= max) return;
    onChange([...values, v]);
    setText('');
  };
  const left = suggestions.filter((s) => !values.some((v) => v.toLowerCase() === s.toLowerCase()));
  return (
    <div className="tag-input">
      <div className="chip-row">
        {values.map((v) => (
          <span className="tag" key={v}>
            {v}
            <button
              type="button"
              aria-label={`Remove ${v}`}
              onClick={() => onChange(values.filter((x) => x !== v))}
            >
              <XIcon size={12} />
            </button>
          </span>
        ))}
      </div>
      <div className="control">
        <input
          value={text}
          placeholder={placeholder}
          maxLength={100}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              add(text);
            }
          }}
        />
        <button type="button" className="icon-btn" aria-label="Add" onClick={() => add(text)}>
          <PlusIcon size={16} />
        </button>
      </div>
      {left.length > 0 && (
        <div className="chip-row" style={{ marginTop: 10 }}>
          {left.map((s) => (
            <button type="button" key={s} className="filter-chip" onClick={() => add(s)}>
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MultiChips({ options, values, onChange }) {
  const toggle = (o) =>
    onChange(values.includes(o) ? values.filter((v) => v !== o) : [...values, o]);
  return (
    <div className="chip-row">
      {options.map((o) => (
        <button
          type="button"
          key={o}
          className={`filter-chip${values.includes(o) ? ' on' : ''}`}
          onClick={() => toggle(o)}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

/** One application photo: picks from the camera/gallery, uploads straight away,
 * previews the local file. `doc` is { url, name, preview? }. */
function DocUpload({ kind, label, hint, doc, onDoc, optional }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  const pick = async (file) => {
    if (!file) return;
    setError('');
    if (file.type && !UPLOAD_TYPES.includes(file.type)) {
      setError('Use a JPEG, PNG or WebP photo.');
      return;
    }
    if (file.size > MAX_UPLOAD) {
      setError('That photo is over 10 MB.');
      return;
    }
    const preview = URL.createObjectURL(file);
    setBusy(true);
    try {
      const res = await api.uploadChauffeurDocument(file, kind);
      onDoc({ url: res.url, name: file.name || `${kind}.jpg`, preview });
    } catch (e) {
      URL.revokeObjectURL(preview);
      setError(e.message || 'Upload failed. Please try again.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="field">
      <label>
        {label} {optional && <span className="choose-hint">optional</span>}
      </label>
      <div className={`doc-upload${doc ? ' done' : ''}`}>
        <span className="doc-thumb">
          {doc?.preview ? <img src={doc.preview} alt="" /> : doc ? <CheckIcon size={20} /> : <IdCardIcon size={20} />}
        </span>
        <span className="doc-text">
          <b>{doc ? doc.name || 'Uploaded' : hint}</b>
          <span>{busy ? 'Uploading…' : doc ? 'Uploaded. Tap to replace it.' : 'JPEG, PNG or WebP, up to 10 MB'}</span>
        </span>
        <label className="btn-secondary btn-sm doc-btn">
          {busy ? 'Uploading…' : doc ? 'Replace' : 'Add photo'}
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="environment"
            disabled={busy}
            onChange={(e) => pick(e.target.files && e.target.files[0])}
          />
        </label>
      </div>
      <FieldError>{error}</FieldError>
    </div>
  );
}

// ---------- step 0: the account, made inside the application ----------

function AccountStep({ form, setField, onDone }) {
  const { signUp, signInWithPassword } = useApp();
  const [mode, setMode] = useState('register'); // register | login
  const [name, setName] = useState(`${form.first_name} ${form.last_name}`.trim());
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const keepName = () => {
    const { first, last } = splitName(name);
    if (first && !form.first_name) setField('first_name', first);
    if (last && !form.last_name) setField('last_name', last);
  };

  const register = async (e) => {
    e.preventDefault();
    if (busy) return;
    const errs = {};
    if (!name.trim()) errs.name = 'Enter your full name.';
    if (!isEmail(email)) errs.email = 'Enter a valid email address.';
    if (password.length < 8) errs.password = 'Use at least 8 characters.';
    if (confirm !== password) errs.confirm = 'Passwords don’t match.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setError('');
    keepName();
    try {
      await signUp({
        fullName: name.trim(),
        email: email.trim(),
        password,
        passwordConfirmation: confirm,
      });
      onDone();
    } catch (err) {
      if (err.status === 400 && /already registered/i.test(err.message)) {
        setMode('login');
        setPassword('');
        setConfirm('');
        setNotice('You already have an Ardena account. Log in to continue.');
      } else {
        setError(err.message || 'Couldn’t create your account. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  const login = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!isEmail(email) || !password) {
      setErrors({
        email: isEmail(email) ? undefined : 'Enter a valid email address.',
        password: password ? undefined : 'Enter your password.',
      });
      return;
    }
    setBusy(true);
    setError('');
    try {
      await signInWithPassword(email.trim(), password);
      onDone();
    } catch (err) {
      setError(err.message || 'Couldn’t log in. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h2 className="drive-step-title">Create your account</h2>
      <p className="drive-step-sub">
        Approved drivers work from the Ardena app’s Chauffeur Mode with this account. Already
        have one?{' '}
        <button type="button" className="link" onClick={() => setMode('login')}>
          Log in
        </button>
      </p>

      {notice && (
        <div className="notice" style={{ marginTop: 0, marginBottom: 18 }}>
          <b>{notice}</b> Everything you’ve typed so far is kept.
        </div>
      )}

      {mode === 'register' ? (
        <form onSubmit={register} noValidate>
          <div className="field">
            <label>Full name</label>
            <div className={`control${errors.name ? ' err' : ''}`}>
              <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Jane Wanjiku" />
            </div>
            <FieldError>{errors.name}</FieldError>
          </div>
          <div className="field">
            <label>Email</label>
            <div className={`control${errors.email ? ' err' : ''}`}>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" />
            </div>
            <FieldError>{errors.email}</FieldError>
          </div>
          <div className="two-col">
            <div className="field">
              <label>Password</label>
              <PasswordInput
                placeholder="At least 8 characters"
                value={password}
                error={errors.password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <FieldError>{errors.password}</FieldError>
            </div>
            <div className="field">
              <label>Confirm password</label>
              <PasswordInput
                placeholder="Repeat your password"
                value={confirm}
                error={errors.confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
              <FieldError>{errors.confirm}</FieldError>
            </div>
          </div>
          {error && <p className="form-error">{error}</p>}
          <button type="submit" className="btn-primary btn-block" disabled={busy}>
            {busy ? 'Creating your account…' : 'Create account and continue'}
          </button>
        </form>
      ) : (
        <form onSubmit={login} noValidate>
          <div className="field">
            <label>Email</label>
            <div className={`control${errors.email ? ' err' : ''}`}>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" />
            </div>
            <FieldError>{errors.email}</FieldError>
          </div>
          <div className="field">
            <label>Password</label>
            <PasswordInput value={password} error={errors.password} onChange={(e) => setPassword(e.target.value)} />
            <FieldError>{errors.password}</FieldError>
          </div>
          {error && <p className="form-error">{error}</p>}
          <button type="submit" className="btn-primary btn-block" disabled={busy}>
            {busy ? 'Logging in…' : 'Log in and continue'}
          </button>
          <div className="auth-links stack">
            <Link to="/forgot" target="_blank" className="link">
              Forgot password?
            </Link>
            <span>
              New to Ardena?{' '}
              <button
                type="button"
                className="link"
                onClick={() => {
                  setMode('register');
                  setNotice('');
                }}
              >
                Create an account
              </button>
            </span>
          </div>
        </form>
      )}

      <div className="auth-divider">or</div>
      <GoogleButton onSignedIn={onDone} onError={setError} />
    </div>
  );
}

// ---------- status page ----------

function StatusPage({ application, onEdit }) {
  const flagged = new Set(
    (application.fix_fields || []).map(stepOfField).filter((i) => i > 0)
  );

  if (application.status === 'approved') {
    return (
      <div className="form-card result-card ok">
        <span className="result-icon">
          <CheckIcon size={30} />
        </span>
        <h1 className="page-title" style={{ marginBottom: 6 }}>
          You’re approved!
        </h1>
        <p className="page-sub">
          Open the Ardena app → Profile → <b>Switch to Chauffeur Mode</b> to go online and take
          trips. Use the same account you applied with.
        </p>
        <div className="store-row">
          <a href={APP_STORE_URL} target="_blank" rel="noopener noreferrer" aria-label="Download on the App Store">
            <img src={appstoreImg} alt="" />
          </a>
          <a href={PLAY_STORE_URL} target="_blank" rel="noopener noreferrer" aria-label="Get it on Google Play">
            <img src={playImg} alt="" />
          </a>
        </div>
      </div>
    );
  }

  if (application.status === 'rejected') {
    return (
      <div className="form-card">
        <span className="lic-badge expired">Changes needed</span>
        <h1 className="page-title" style={{ margin: '14px 0 6px' }}>
          Your application needs a few fixes
        </h1>
        {application.reason && <div className="notice" style={{ marginTop: 8 }}>{application.reason}</div>}
        {flagged.size > 0 && (
          <div className="info-card" style={{ marginTop: 'var(--sp-4)' }}>
            {[...flagged].sort().map((i) => {
              const Icon = STEPS[i].icon;
              return (
                <div className="info-row" key={i}>
                  <span>
                    <Icon size={17} /> {STEPS[i].title}
                  </span>
                  <b style={{ color: 'var(--error)' }}>Fix this</b>
                </div>
              );
            })}
          </div>
        )}
        <button className="btn-primary btn-block" style={{ marginTop: 'var(--sp-5)' }} onClick={onEdit}>
          Fix and resubmit
        </button>
      </div>
    );
  }

  return (
    <div className="form-card result-card">
      <span className="result-icon">
        <ClockIcon size={30} />
      </span>
      <h1 className="page-title" style={{ marginBottom: 6 }}>
        Application in review
      </h1>
      <p className="page-sub">
        We’ll notify you as soon as it’s checked
        {application.submitted_at ? `. Sent on ${fmtDay(application.submitted_at)}.` : '.'}
      </p>
      <button className="btn-secondary" onClick={onEdit}>
        Edit and resubmit
      </button>
      <p className="breakdown-note" style={{ marginTop: 14 }}>
        Re-submitting replaces the application you sent.
      </p>
    </div>
  );
}

// ---------- the page ----------

export default function Drive() {
  const { user, authPending } = useApp();
  const draft = useRef(loadDraft());
  const [form, setForm] = useState(() => draft.current?.form || EMPTY_FORM);
  const [step, setStep] = useState(() => Math.max(draft.current?.step || 0, 0));
  const [docs, setDocs] = useState({});
  const [prefill, setPrefill] = useState(null);
  const [application, setApplication] = useState(null);
  const [view, setView] = useState('loading'); // loading | form | status
  const [stepErrors, setStepErrors] = useState({}); // { stepIndex: message }
  const [flagged, setFlagged] = useState(() => new Set());
  const [submitting, setSubmitting] = useState(false);
  const [locating, setLocating] = useState(false);
  const [usingAvatar, setUsingAvatar] = useState(false);
  const topRef = useRef(null);

  const setField = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const setDoc = (key, value) => setDocs((d) => ({ ...d, [key]: value }));
  const licenceOnFile = Boolean(prefill?.licence?.verified);

  useEffect(() => {
    if (view === 'form') saveDraft(form, step);
  }, [form, step, view]);

  // Signed out: the application starts with the account step.
  // Signed in: show the status page if they've applied, else prefill the form.
  useEffect(() => {
    if (authPending) return undefined;
    if (!user) {
      setStep(0);
      setView('form');
      return undefined;
    }
    let on = true;
    setView('loading');
    api
      .getChauffeurApplication()
      .then((app) => {
        if (!on) return;
        setApplication(app);
        setView('status');
      })
      .catch((e) => {
        if (!on) return;
        if (e.status !== 404) setStepErrors({ 1: e.message });
        setStep((s) => Math.max(s, 1));
        setView('form');
      });
    api
      .getChauffeurPrefill()
      .then((p) => {
        if (!on) return;
        setPrefill(p);
        setForm((f) => ({
          ...f,
          first_name: f.first_name || p.first_name || '',
          last_name: f.last_name || p.last_name || '',
          phone: f.phone || p.phone || '',
        }));
      })
      .catch(() => {});
    return () => {
      on = false;
    };
  }, [user?.id, authPending]);

  const scrollTop = () => topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const goTo = (i) => {
    setStep(i);
    scrollTop();
  };

  /** Edit and resubmit: the form, filled from what they sent. */
  const editApplication = () => {
    const a = application || {};
    const pick = (k) => (a[k] === undefined || a[k] === null ? EMPTY_FORM[k] : a[k]);
    setForm({
      ...EMPTY_FORM,
      first_name: pick('first_name'),
      last_name: pick('last_name'),
      phone: pick('phone'),
      years_experience: String(pick('years_experience') ?? ''),
      languages: pick('languages'),
      bio: pick('bio') || '',
      licence_number: a.licence_verified_on_profile ? '' : pick('licence_number') || '',
      base_town: pick('base_town'),
      areas_served: pick('areas_served'),
      nationwide: Boolean(a.nationwide),
      base_lat: a.base_lat ?? null,
      base_lng: a.base_lng ?? null,
      car_types: pick('car_types'),
      transmissions: pick('transmissions'),
      service_type: pick('service_type'),
      days: pick('days'),
      start: pick('start'),
      end: pick('end'),
      price_per_day: String(pick('price_per_day') ?? ''),
      price_per_hour: String(pick('price_per_hour') ?? ''),
      references: a.references?.length ? a.references : EMPTY_FORM.references,
      agreed: false,
    });
    // Links to files already sent go back unchanged; no local file to preview.
    const fileDocs = {};
    for (const k of ['photo', 'licence_photo', 'id_photo', 'good_conduct_photo']) {
      if (a[k]?.url) fileDocs[k] = { url: a[k].url, name: a[k].name || 'On file' };
    }
    setDocs(fileDocs);
    const fix = new Set((a.fix_fields || []).map(stepOfField).filter((i) => i > 0));
    setFlagged(fix);
    setStepErrors({});
    setStep(fix.size ? Math.min(...fix) : 1);
    setView('form');
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setStepErrors((e) => ({ ...e, 3: 'Your browser can’t share your location.' }));
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setForm((f) => ({ ...f, base_lat: pos.coords.latitude, base_lng: pos.coords.longitude }));
      },
      (err) => {
        setLocating(false);
        setStepErrors((e) => ({
          ...e,
          3: err.code === 1 ? 'Location is blocked for this site. Allow it to drop your pin.' : 'Couldn’t get your location.',
        }));
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  };

  /** "Use my profile photo": upload the account's avatar as the application photo. */
  const useAvatar = async () => {
    if (!prefill?.photo_url || usingAvatar) return;
    setUsingAvatar(true);
    try {
      const res = await fetch(prefill.photo_url);
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const file = new File([blob], 'profile-photo.jpg', { type: blob.type || 'image/jpeg' });
      const up = await api.uploadChauffeurDocument(file, 'photo');
      setDoc('photo', { url: up.url, name: 'Your profile photo', preview: URL.createObjectURL(blob) });
    } catch (e) {
      setStepErrors((x) => ({
        ...x,
        1: e?.message || 'Couldn’t use your profile photo. Add a photo below instead.',
      }));
    } finally {
      setUsingAvatar(false);
    }
  };

  /** Light checks before moving on; the server has the last word. */
  const checkStep = (i) => {
    const f = form;
    if (i === 1) {
      if (!f.first_name.trim() || !f.last_name.trim()) return 'Enter your first and last name.';
      if (!KE_MOBILE.test(f.phone.replace(/[\s-]/g, ''))) return 'Use a Kenyan mobile number, e.g. 0712 345 678.';
      if (!docs.photo) return 'Add a clear photo of yourself.';
      const years = Number(f.years_experience);
      if (f.years_experience === '' || !Number.isInteger(years) || years < 0 || years > 60)
        return 'Enter your years of driving experience (0 to 60).';
      if (!f.languages.length) return 'Add at least one language you speak.';
    }
    if (i === 2) {
      if (!licenceOnFile) {
        if (f.licence_number.trim().length < 4) return 'Enter your driving licence number.';
        if (!docs.licence_photo) return 'Upload a photo of your driving licence.';
      }
      if (!docs.id_photo) return 'Upload a photo of your ID.';
    }
    if (i === 3 && f.base_town.trim().length < 2) return 'Enter the town you usually work from.';
    if (i === 4) {
      if (!f.car_types.length) return 'Choose at least one car type you can drive.';
      if (!f.transmissions.length) return 'Choose Automatic, Manual or both.';
      if (!f.days.length) return 'Choose the days you work.';
      if (!f.start || !f.end || f.end <= f.start) return 'Your working hours have to end after they start.';
    }
    if (i === 5) {
      const day = Number(f.price_per_day);
      const hour = Number(f.price_per_hour);
      if (!(day >= 500 && day <= 50000)) return 'Your daily rate must be between KSh 500 and KSh 50,000.';
      if (!(hour >= 100 && hour <= 10000)) return 'Your hourly rate must be between KSh 100 and KSh 10,000.';
      for (const r of f.references) {
        const has = r.name.trim() || r.phone.trim();
        if (has && (r.name.trim().length < 2 || !KE_MOBILE.test(r.phone.replace(/[\s-]/g, ''))))
          return 'Give each reference a name and a Kenyan mobile number, or leave it empty.';
      }
      if (!f.agreed) return 'You need to agree to the chauffeur terms to apply.';
    }
    return '';
  };

  const next = () => {
    const problem = checkStep(step);
    setStepErrors((e) => ({ ...e, [step]: problem }));
    if (problem) return;
    setFlagged((s) => {
      const n = new Set(s);
      n.delete(step);
      return n;
    });
    goTo(step + 1);
  };

  const payload = () => {
    const f = form;
    const file = (k) => (docs[k] ? { url: docs[k].url, name: docs[k].name || null } : null);
    const body = {
      first_name: f.first_name.trim(),
      last_name: f.last_name.trim(),
      phone: f.phone.trim(),
      photo: file('photo'),
      years_experience: Number(f.years_experience),
      languages: f.languages,
      bio: f.bio.trim() || null,
      id_photo: file('id_photo'),
      good_conduct_photo: file('good_conduct_photo'),
      base_town: f.base_town.trim(),
      areas_served: f.areas_served,
      nationwide: f.nationwide,
      car_types: f.car_types,
      transmissions: f.transmissions,
      service_type: f.service_type,
      days: DAYS.filter((d) => f.days.includes(d)),
      start: f.start,
      end: f.end,
      price_per_day: Number(f.price_per_day),
      price_per_hour: Number(f.price_per_hour),
      references: f.references
        .filter((r) => r.name.trim() && r.phone.trim())
        .map((r) => ({ name: r.name.trim(), phone: r.phone.trim() })),
      agreed: f.agreed,
    };
    // A verified licence on the profile stands in for the licence step.
    if (!licenceOnFile) {
      body.licence_number = f.licence_number.trim();
      body.licence_photo = file('licence_photo');
    }
    if (f.base_lat != null && f.base_lng != null) {
      body.base_lat = f.base_lat;
      body.base_lng = f.base_lng;
    }
    return body;
  };

  const submit = async () => {
    if (submitting) return;
    for (let i = 1; i < STEPS.length; i++) {
      const problem = checkStep(i);
      if (problem) {
        setStepErrors((e) => ({ ...e, [i]: problem }));
        goTo(i);
        return;
      }
    }
    setSubmitting(true);
    setStepErrors({});
    try {
      const app = await api.submitChauffeurApplication(payload());
      clearDraft();
      setApplication(app);
      setFlagged(new Set());
      setView('status');
      scrollTop();
    } catch (e) {
      if (e.status === 409 && /approved/i.test(e.message)) {
        setApplication({ status: 'approved' });
        setView('status');
        return;
      }
      const i = stepForError(e);
      const at = i > 0 ? i : step;
      setStepErrors({ [at]: e.message || 'Couldn’t send your application. Please try again.' });
      setFlagged((s) => new Set(s).add(at));
      goTo(at);
    } finally {
      setSubmitting(false);
    }
  };

  if (authPending || view === 'loading') {
    return (
      <div className="page container drive-page">
        <div className="form-card">
          <div className="skel-line" style={{ width: '40%', height: 22, marginTop: 0 }} />
          <div className="skel-line" style={{ width: '70%', height: 14 }} />
          <div className="skel-line" style={{ width: '100%', height: 46, marginTop: 24 }} />
        </div>
      </div>
    );
  }

  const firstStep = user ? 1 : 0;
  const visibleSteps = STEPS.map((s, i) => ({ ...s, i })).filter((s) => s.i >= firstStep);
  const error = stepErrors[step];

  return (
    <div className="page container drive-page" ref={topRef}>
      <div className="drive-hero">
        <span className="promo-icon">
          <SteeringIcon size={22} />
        </span>
        <div>
          <h1 className="page-title" style={{ marginBottom: 4 }}>
            Drive with Ardena
          </h1>
          <p className="page-sub" style={{ margin: 0 }}>
            Set your own rates and hours, and get hired by renters near you.
          </p>
        </div>
      </div>

      {view === 'status' && application ? (
        <StatusPage application={application} onEdit={editApplication} />
      ) : (
        <>
          <ol className="drive-steps">
            {visibleSteps.map((s) => (
              <li key={s.key}>
                <button
                  type="button"
                  className={`drive-step${s.i === step ? ' active' : ''}${s.i < step ? ' done' : ''}${
                    flagged.has(s.i) || (stepErrors[s.i] && s.i !== step) ? ' flagged' : ''
                  }`}
                  disabled={s.i > step || (!user && s.i > 0)}
                  onClick={() => goTo(s.i)}
                >
                  <span className="drive-step-dot">{s.i < step ? <CheckIcon size={12} /> : s.i - firstStep + 1}</span>
                  <span className="drive-step-label">{s.title}</span>
                </button>
              </li>
            ))}
          </ol>

          <div className="form-card">
            {step === 0 && !user && (
              <AccountStep form={form} setField={setField} onDone={() => goTo(1)} />
            )}

            {step === 1 && (
              <>
                <h2 className="drive-step-title">About you</h2>
                <p className="drive-step-sub">Renters see your first name, photo and languages.</p>
                <div className="two-col">
                  <div className="field">
                    <label>First name</label>
                    <div className="control">
                      <input value={form.first_name} maxLength={100} onChange={(e) => setField('first_name', e.target.value)} autoComplete="given-name" />
                    </div>
                  </div>
                  <div className="field">
                    <label>Last name</label>
                    <div className="control">
                      <input value={form.last_name} maxLength={100} onChange={(e) => setField('last_name', e.target.value)} autoComplete="family-name" />
                    </div>
                  </div>
                  <div className="field">
                    <label>Mobile number</label>
                    <div className="control">
                      <input type="tel" value={form.phone} onChange={(e) => setField('phone', e.target.value)} placeholder="0712 345 678" autoComplete="tel" />
                    </div>
                  </div>
                  <div className="field">
                    <label>Years of driving experience</label>
                    <div className="control">
                      <input type="number" min={0} max={60} inputMode="numeric" value={form.years_experience} onChange={(e) => setField('years_experience', e.target.value)} />
                    </div>
                  </div>
                </div>

                {prefill?.photo_url && !docs.photo && (
                  <div className="avatar-offer">
                    <img src={prefill.photo_url} alt="" />
                    <span>Use the photo on your Ardena profile?</span>
                    <button type="button" className="btn-secondary btn-sm" onClick={useAvatar} disabled={usingAvatar}>
                      {usingAvatar ? 'Adding…' : 'Use this photo'}
                    </button>
                  </div>
                )}
                <DocUpload
                  kind="photo"
                  label="Your photo"
                  hint="A clear photo of your face"
                  doc={docs.photo}
                  onDoc={(d) => setDoc('photo', d)}
                />

                <div className="field">
                  <label>Languages you speak</label>
                  <TagInput
                    values={form.languages}
                    onChange={(v) => setField('languages', v)}
                    placeholder="Add a language"
                    suggestions={LANGUAGE_SUGGESTIONS}
                    max={10}
                  />
                </div>
                <div className="field">
                  <label>
                    About you <span className="choose-hint">optional</span>
                  </label>
                  <div className="control" style={{ height: 'auto' }}>
                    <textarea rows={3} maxLength={1000} value={form.bio} onChange={(e) => setField('bio', e.target.value)} placeholder="e.g. Ten years driving executives around Nairobi. Calm, on time, knows every shortcut." />
                  </div>
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <h2 className="drive-step-title">Licence &amp; ID</h2>
                <p className="drive-step-sub">Only Ardena sees these. They’re kept private.</p>
                {licenceOnFile ? (
                  <div className="licence-on-file">
                    <IdCardIcon size={22} />
                    <span>
                      <b>
                        •••• {String(prefill.licence.licence_number || '').slice(-4)}
                        {prefill.licence.category ? ` · ${prefill.licence.category}` : ''}
                      </b>
                      <span>Valid until {fmtDay(prefill.licence.expiry_date)}</span>
                    </span>
                    <span className="lic-badge verified">
                      <CheckIcon size={13} /> Verified
                    </span>
                  </div>
                ) : (
                  <>
                    {prefill?.licence?.expired && (
                      <div className="notice" style={{ marginTop: 0, marginBottom: 18 }}>
                        The licence on your profile has expired. Add your current one here.
                      </div>
                    )}
                    <div className="field">
                      <label>Driving licence number</label>
                      <div className="control">
                        <input value={form.licence_number} maxLength={50} onChange={(e) => setField('licence_number', e.target.value.toUpperCase())} placeholder="e.g. B123456 or your ID number" />
                      </div>
                    </div>
                    <DocUpload kind="licence_photo" label="Driving licence photo" hint="The front of your licence" doc={docs.licence_photo} onDoc={(d) => setDoc('licence_photo', d)} />
                  </>
                )}
                <DocUpload kind="id_photo" label="ID photo" hint="Your national ID or passport" doc={docs.id_photo} onDoc={(d) => setDoc('id_photo', d)} />
                <DocUpload kind="good_conduct_photo" label="Certificate of good conduct" hint="Helps you get approved faster" doc={docs.good_conduct_photo} onDoc={(d) => setDoc('good_conduct_photo', d)} optional />
              </>
            )}

            {step === 3 && (
              <>
                <h2 className="drive-step-title">Where you drive</h2>
                <p className="drive-step-sub">We only show renters your area, never the exact spot.</p>
                <div className="field">
                  <label>Town you work from</label>
                  <div className="control">
                    <input value={form.base_town} maxLength={100} onChange={(e) => setField('base_town', e.target.value)} placeholder="e.g. Nakuru" />
                  </div>
                </div>
                <div className="field">
                  <label>
                    Other areas you cover <span className="choose-hint">optional</span>
                  </label>
                  <TagInput values={form.areas_served} onChange={(v) => setField('areas_served', v)} placeholder="Add a town or area" max={30} />
                </div>
                <div className="toggle-row" style={{ marginBottom: 'var(--sp-5)' }}>
                  <div className="t-label">
                    <b>I drive anywhere in Kenya</b>
                    <span>Show me to renters in every town</span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={form.nationwide}
                    className={`switch${form.nationwide ? ' on' : ''}`}
                    onClick={() => setField('nationwide', !form.nationwide)}
                  />
                </div>

                <div className="field">
                  <label>
                    Where you usually start <span className="choose-hint">optional</span>
                  </label>
                  {form.base_lat != null ? (
                    <>
                      <PinMap
                        picker
                        lat={form.base_lat}
                        lng={form.base_lng}
                        zoom={14}
                        onChange={({ lat, lng }) => setForm((f) => ({ ...f, base_lat: lat, base_lng: lng }))}
                      />
                      <div className="locate-row">
                        <span className="car-meta">Drag the map to put the pin where you usually start.</span>
                        <button type="button" className="link" onClick={() => setForm((f) => ({ ...f, base_lat: null, base_lng: null }))}>
                          Remove pin
                        </button>
                      </div>
                    </>
                  ) : (
                    <button type="button" className="btn-secondary" onClick={useMyLocation} disabled={locating}>
                      <MapPinIcon size={16} /> {locating ? 'Finding you…' : 'Use my current location'}
                    </button>
                  )}
                  <p className="field-hint">
                    It puts you on the map for “near me” searches. We only show renters your area,
                    never the exact spot.
                  </p>
                </div>
              </>
            )}

            {step === 4 && (
              <>
                <h2 className="drive-step-title">Cars &amp; hours</h2>
                <div className="field">
                  <label>Cars you can drive</label>
                  <MultiChips options={CAR_TYPES} values={form.car_types} onChange={(v) => setField('car_types', v)} />
                </div>
                <div className="field">
                  <label>Transmissions</label>
                  <MultiChips options={TRANSMISSIONS} values={form.transmissions} onChange={(v) => setField('transmissions', v)} />
                </div>
                <div className="field">
                  <label>What you offer</label>
                  <div className="seg">
                    {[
                      ['driver_only', 'Driver only'],
                      ['car_and_driver', 'Car and driver'],
                    ].map(([value, text]) => (
                      <button
                        type="button"
                        key={value}
                        className={`choice-btn${form.service_type === value ? ' selected' : ''}`}
                        onClick={() => setField('service_type', value)}
                      >
                        <span className="radio-dot" /> {text}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="field">
                  <label>Days you work</label>
                  <MultiChips options={DAYS} values={form.days} onChange={(v) => setField('days', v)} />
                </div>
                <div className="two-col">
                  <div className="field">
                    <label>From</label>
                    <div className="control">
                      <input type="time" value={form.start} onChange={(e) => setField('start', e.target.value)} />
                    </div>
                  </div>
                  <div className="field">
                    <label>Until</label>
                    <div className="control">
                      <input type="time" value={form.end} onChange={(e) => setField('end', e.target.value)} />
                    </div>
                  </div>
                </div>
              </>
            )}

            {step === 5 && (
              <>
                <h2 className="drive-step-title">Rates &amp; references</h2>
                <div className="two-col">
                  <div className="field">
                    <label>Daily rate (KSh)</label>
                    <div className="control">
                      <input type="number" inputMode="numeric" min={500} max={50000} value={form.price_per_day} onChange={(e) => setField('price_per_day', e.target.value)} placeholder="500 to 50,000" />
                    </div>
                  </div>
                  <div className="field">
                    <label>Hourly rate (KSh)</label>
                    <div className="control">
                      <input type="number" inputMode="numeric" min={100} max={10000} value={form.price_per_hour} onChange={(e) => setField('price_per_hour', e.target.value)} placeholder="100 to 10,000" />
                    </div>
                  </div>
                </div>

                <div className="field">
                  <label>
                    References <span className="choose-hint">up to 3, optional</span>
                  </label>
                  {form.references.map((r, i) => (
                    <div className="ref-row" key={i}>
                      <div className="control">
                        <input
                          value={r.name}
                          placeholder="Name"
                          maxLength={100}
                          onChange={(e) =>
                            setField('references', form.references.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                          }
                        />
                      </div>
                      <div className="control">
                        <input
                          type="tel"
                          value={r.phone}
                          placeholder="0712 345 678"
                          onChange={(e) =>
                            setField('references', form.references.map((x, j) => (j === i ? { ...x, phone: e.target.value } : x)))
                          }
                        />
                      </div>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label="Remove reference"
                        onClick={() => setField('references', form.references.filter((_, j) => j !== i))}
                      >
                        <XIcon size={14} />
                      </button>
                    </div>
                  ))}
                  {form.references.length < 3 && (
                    <button
                      type="button"
                      className="link"
                      onClick={() => setField('references', [...form.references, { name: '', phone: '' }])}
                    >
                      + Add a reference
                    </button>
                  )}
                </div>

                <label className="agree-row">
                  <input type="checkbox" checked={form.agreed} onChange={(e) => setField('agreed', e.target.checked)} />
                  <span>
                    I agree to the{' '}
                    <a href="https://ardena.co.ke/terms" target="_blank" rel="noopener noreferrer" className="link">
                      Ardena chauffeur terms
                    </a>{' '}
                    and confirm these details are true.
                  </span>
                </label>
              </>
            )}

            {error && step > 0 && <p className="form-error">{error}</p>}

            {step > 0 && (
              <div className="drive-nav">
                {step > firstStep && (
                  <button type="button" className="btn-secondary" onClick={() => goTo(step - 1)} disabled={submitting}>
                    Back
                  </button>
                )}
                {step < STEPS.length - 1 ? (
                  <button type="button" className="btn-primary" onClick={next}>
                    Continue
                  </button>
                ) : (
                  <button type="button" className="btn-primary" onClick={submit} disabled={submitting}>
                    {submitting ? 'Sending…' : 'Send application'}
                  </button>
                )}
              </div>
            )}
          </div>
          <p className="breakdown-note" style={{ textAlign: 'center', marginTop: 14 }}>
            Your answers are saved in this tab while you fill the form in.
          </p>
        </>
      )}
    </div>
  );
}
