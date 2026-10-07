import React, { useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useApp } from '../store.jsx';
import { Avatar } from '../components.jsx';
import * as api from '../api.js';
import { useToast } from '../toast.jsx';
import { UserIcon, IdCardIcon, CheckIcon, PhoneIcon, ShieldIcon } from '../icons.jsx';

function AccountLayout({ children }) {
  return (
    <div className="page">
      <div className="container wide">
        <div className="account-layout">
          <aside className="side-nav">
            <NavLink to="/profile" className={({ isActive }) => `side-link${isActive ? ' active' : ''}`}>
              <UserIcon size={17} /> Profile
            </NavLink>
            <NavLink to="/license" className={({ isActive }) => `side-link${isActive ? ' active' : ''}`}>
              <IdCardIcon size={17} /> Driver&apos;s licence
            </NavLink>
          </aside>
          <div>{children}</div>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div className="field">
      <label>{label}</label>
      <div className="control readonly">{value || '—'}</div>
    </div>
  );
}

const GENDERS = ['Male', 'Female', 'Other', 'Prefer not to say'];

export function Profile() {
  const { user, updateProfile } = useApp();
  const toast = useToast();
  const fromUser = () => ({
    fullName: user.fullName || '',
    phone: user.phone || '',
    dob: user.dob || '',
    gender: user.gender || '',
    bio: user.bio || '',
  });
  const [form, setForm] = useState(fromUser);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // The profile re-hydrates from the backend after mount — keep the form in sync
  // until the user starts editing, so it never shows stale cached values.
  useEffect(() => {
    if (!dirty) setForm(fromUser());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, user.fullName, user.phone, user.dob, user.gender, user.bio]);

  const set = (key) => (e) => {
    setDirty(true);
    const { value } = e.target;
    setForm((f) => ({ ...f, [key]: value }));
  };

  const changed =
    form.fullName.trim() !== (user.fullName || '') ||
    form.phone.trim() !== (user.phone || '') ||
    form.dob !== (user.dob || '') ||
    form.gender !== (user.gender || '') ||
    form.bio.trim() !== (user.bio || '');

  const save = async () => {
    if (saving || !changed) return;
    if (!form.fullName.trim()) {
      toast.error('Full name can’t be empty');
      return;
    }
    setSaving(true);
    try {
      // Partial update — only send what changed.
      const fields = {};
      if (form.fullName.trim() !== (user.fullName || '')) fields.full_name = form.fullName.trim();
      if (form.phone.trim() !== (user.phone || '')) fields.mobile_number = form.phone.trim();
      if (form.dob !== (user.dob || '')) fields.date_of_birth = form.dob;
      if (form.gender !== (user.gender || '')) fields.gender = form.gender;
      if (form.bio.trim() !== (user.bio || '')) fields.bio = form.bio.trim();
      await updateProfile(fields);
      setDirty(false);
      toast.success('Profile updated');
    } catch (e) {
      toast.error(e.message || 'Could not save your profile. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AccountLayout>
      <div className="cards-row">
        <div className="form-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-4)', marginBottom: 26 }}>
            <Avatar user={user} size={64} fontSize={22} />
            <div>
              <b style={{ fontSize: 'var(--fs-lg)' }}>{user.fullName}</b>
              <div className="car-meta">
                Ardena member{user.memberSince ? ` since ${user.memberSince}` : ''}
              </div>
            </div>
          </div>
          <div className="two-col">
            <div className="field">
              <label>Full name</label>
              <div className="control">
                <input value={form.fullName} onChange={set('fullName')} autoComplete="name" />
              </div>
            </div>
            <div className="field">
              <label>Mobile</label>
              <div className="control">
                <input
                  value={form.phone}
                  onChange={set('phone')}
                  placeholder="+254 7XX XXX XXX"
                  autoComplete="tel"
                  inputMode="tel"
                />
              </div>
            </div>
            <div className="field">
              <label>Date of birth</label>
              <div className="control">
                <input type="date" value={form.dob} onChange={set('dob')} />
              </div>
            </div>
            <div className="field">
              <label>Gender</label>
              <div className="control">
                <select value={form.gender} onChange={set('gender')}>
                  <option value="">Select…</option>
                  {GENDERS.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <InfoRow label="ID number" value={user.idNumber} />
            <InfoRow label="Email" value={user.email} />
          </div>
        </div>

        <div className="form-card">
          <h2 style={{ fontSize: 'var(--fs-lg)', fontWeight: 700, marginBottom: 'var(--sp-4)' }}>About</h2>
          <div className="field">
            <label>Bio</label>
            <div className="control" style={{ height: 'auto' }}>
              <textarea
                rows={4}
                value={form.bio}
                onChange={set('bio')}
                placeholder="Tell hosts a little about yourself"
              />
            </div>
          </div>
          <button
            className="btn-primary btn-block"
            style={{ marginTop: 'var(--sp-4)' }}
            disabled={saving || !changed}
            onClick={save}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          <div className="notice" style={{ marginTop: 'var(--sp-4)' }}>
            Web and the <b>Ardena app</b> share one account — changes you save here appear in the
            app automatically. Profile photo and ID number are managed in the app.
          </div>
        </div>
      </div>
    </AccountLayout>
  );
}

const ID_TYPES = [
  { value: 'DRIVERS_LICENSE', label: 'Driving licence' },
  { value: 'NATIONAL_ID', label: 'National ID' },
  { value: 'PASSPORT', label: 'Passport' },
];

const KYC_POLL_MS = 8000;

function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-KE', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

// ---------- driving licence details (GET/POST/PUT /client/driving-license) ----------

const LICENCE_CATEGORIES = ['A', 'A1', 'A2', 'A3', 'B', 'B1', 'B2', 'B3', 'C', 'C1', 'CE', 'D', 'D1', 'D2', 'D3', 'E', 'F', 'G'];

function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** No licence → "Add licence"; unverified → grey; verified & in date → green; expired → red. */
function licenceBadge(dl) {
  if (!dl) return { cls: 'lic-badge none', label: 'Add licence' };
  if (dl.expiry_date && String(dl.expiry_date).slice(0, 10) < todayISO()) {
    return { cls: 'lic-badge expired', label: 'Expired, update it' };
  }
  if (dl.is_verified) return { cls: 'lic-badge verified', label: 'Verified' };
  return { cls: 'lic-badge pending', label: 'Not verified yet' };
}

function DrivingLicenceCard() {
  const toast = useToast();
  const [dl, setDl] = useState(undefined); // undefined = loading, null = none on file
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ number: '', category: 'B', issue: '', expiry: '' });
  const [confirmUnverify, setConfirmUnverify] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let on = true;
    api
      .getDrivingLicense()
      .then((data) => {
        if (on) setDl(data);
      })
      .catch(() => {
        if (on) setDl(null);
      });
    return () => {
      on = false;
    };
  }, []);

  if (dl === undefined) {
    return (
      <div className="form-card" style={{ maxWidth: 640, marginBottom: 'var(--sp-5)' }}>
        <div className="skel-line" style={{ width: '45%', height: 18, marginTop: 0 }} />
        <div className="skel-line" style={{ width: '70%', height: 13 }} />
      </div>
    );
  }

  const badge = licenceBadge(dl);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const startEdit = () => {
    setForm({
      number: dl?.license_number || '',
      category: dl?.category || 'B',
      issue: dl?.issue_date ? String(dl.issue_date).slice(0, 10) : '',
      expiry: dl?.expiry_date ? String(dl.expiry_date).slice(0, 10) : '',
    });
    setError('');
    setConfirmUnverify(false);
    setEditing(true);
  };

  const save = async () => {
    if (saving) return;
    if (!form.number.trim() || !form.category || !form.issue || !form.expiry) {
      setError('Fill in the licence number, category and both dates.');
      return;
    }
    // Editing a verified licence removes the badge until Ardena checks it again.
    if (dl?.is_verified && !confirmUnverify) {
      setConfirmUnverify(true);
      return;
    }
    setSaving(true);
    setError('');
    try {
      const saved = await api.saveDrivingLicense(
        {
          license_number: form.number.trim(),
          category: form.category,
          issue_date: form.issue,
          expiry_date: form.expiry,
        },
        Boolean(dl)
      );
      setDl(saved);
      setEditing(false);
      setConfirmUnverify(false);
      toast.success(dl ? 'Licence updated' : 'Licence added');
    } catch (e) {
      setError(e.message || 'Couldn’t save your licence. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="form-card" style={{ maxWidth: 640, marginBottom: 'var(--sp-5)' }}>
      <div className="toggle-row" style={{ marginBottom: editing || dl ? 18 : 0 }}>
        <div className="t-label">
          <b>Driving licence</b>
          <span>Needed for self-drive trips, same licence as in the app</span>
        </div>
        {dl ? (
          <span className={badge.cls}>
            {badge.label === 'Verified' && <CheckIcon size={13} />} {badge.label}
          </span>
        ) : (
          !editing && (
            <button className="btn-secondary btn-sm" onClick={startEdit}>
              Add licence
            </button>
          )
        )}
      </div>

      {dl && !editing && (
        <>
          <div className="two-col">
            <InfoRow label="Licence number" value={dl.license_number} />
            <InfoRow label="Category" value={dl.category} />
            <InfoRow label="Issued" value={fmtDate(dl.issue_date)} />
            <InfoRow label="Expires" value={fmtDate(dl.expiry_date)} />
          </div>
          {!dl.is_verified && dl.verification_notes && (
            <div className="notice" style={{ marginTop: 0 }}>
              {dl.verification_notes}
            </div>
          )}
          <button className="btn-secondary" onClick={startEdit}>
            {badge.cls.includes('expired') ? 'Update licence' : 'Edit licence'}
          </button>
        </>
      )}

      {editing && (
        <>
          <div className="two-col">
            <div className="field">
              <label>Licence number</label>
              <div className="control">
                <input
                  value={form.number}
                  onChange={set('number')}
                  placeholder="e.g. B123456 or your ID number"
                  maxLength={50}
                />
              </div>
            </div>
            <div className="field">
              <label>Category</label>
              <div className="control">
                <select value={form.category} onChange={set('category')}>
                  {LICENCE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="field">
              <label>Issue date</label>
              <div className="control">
                <input type="date" value={form.issue} max={todayISO()} onChange={set('issue')} />
              </div>
            </div>
            <div className="field">
              <label>Expiry date</label>
              <div className="control">
                <input type="date" value={form.expiry} onChange={set('expiry')} />
              </div>
            </div>
          </div>

          {confirmUnverify && (
            <div className="notice" style={{ marginTop: 0, marginBottom: 'var(--sp-4)' }}>
              <b>Changing your licence removes its Verified badge</b> until Ardena checks it again.
              Save anyway?
            </div>
          )}
          {error && (
            <p style={{ color: 'var(--error)', fontSize: 'var(--fs-sm)', fontWeight: 700, marginBottom: 12 }}>
              {error}
            </p>
          )}
          <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
            <button className="btn-primary" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : confirmUnverify ? 'Yes, save changes' : 'Save licence'}
            </button>
            <button
              className="btn-secondary"
              onClick={() => {
                setEditing(false);
                setConfirmUnverify(false);
              }}
              disabled={saving}
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function License() {
  const { user } = useApp();
  const [kyc, setKyc] = useState(null);
  const [loading, setLoading] = useState(true);
  // Dojah widget session: { url } once verification has been started
  const [session, setSession] = useState(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [qrFailed, setQrFailed] = useState(false);
  // Optional ID confirmation (prefills the profile from the government registry)
  const [idType, setIdType] = useState('DRIVERS_LICENSE');
  const [idNumber, setIdNumber] = useState('');
  const [lookup, setLookup] = useState(null);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupError, setLookupError] = useState('');
  const pollRef = useRef(null);

  const refreshStatus = () =>
    api
      .getKycStatus()
      .then((data) => {
        setKyc(data);
        if (data.status === 'approved' || data.status === 'declined') {
          setSession(null);
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
        }
        return data;
      })
      .catch(() => null);

  useEffect(() => {
    refreshStatus().finally(() => setLoading(false));
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll while the widget session is open or a decision is still pending.
  useEffect(() => {
    const shouldPoll = session || kyc?.status === 'pending';
    if (shouldPoll && !pollRef.current) {
      pollRef.current = setInterval(() => {
        if (document.visibilityState === 'visible') refreshStatus();
      }, KYC_POLL_MS);
    }
    if (!shouldPoll && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, kyc?.status]);

  const confirmId = async () => {
    if (lookupBusy || !idNumber.trim()) return;
    setLookupBusy(true);
    setLookupError('');
    try {
      setLookup(await api.kycLookup(idType, idNumber.trim()));
    } catch (e) {
      setLookupError(e.message || 'ID not found. Please check the details.');
    } finally {
      setLookupBusy(false);
    }
  };

  const startVerification = async () => {
    if (starting) return;
    setStarting(true);
    setError('');
    try {
      const creds = await api.initializeKyc();
      setSession({ url: api.buildDojahUrl(creds) });
      setQrFailed(false);
    } catch (e) {
      setError(e.message || 'Could not start verification. Please try again.');
    } finally {
      setStarting(false);
    }
  };

  if (loading) {
    return (
      <AccountLayout>
        <div className="empty">Loading verification status…</div>
      </AccountLayout>
    );
  }

  const status = kyc?.status || 'not_started';
  const uploaded = Boolean(user.licenseDocumentUrl);

  return (
    <AccountLayout>
      <DrivingLicenceCard />
      {status === 'approved' ? (
        <div className="form-card" style={{ maxWidth: 640 }}>
          <div className="toggle-row" style={{ marginBottom: 18 }}>
            <div className="t-label">
              <b>Identity &amp; driver&apos;s licence</b>
              <span>Verified with a document scan and liveness check</span>
            </div>
            <span
              className="status-pill confirmed"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
            >
              <CheckIcon size={13} /> Verified
            </span>
          </div>
          <div className="two-col">
            <InfoRow label="Verified name" value={kyc.verified_name} />
            <InfoRow label="Document" value={kyc.document_type} />
            <InfoRow label="Date of birth" value={kyc.verified_dob} />
            <InfoRow label="Verified on" value={fmtDate(kyc.verified_at)} />
          </div>
          <div className="notice">
            You&apos;re all set. Hosts see you as a verified driver, on web and in the app.
          </div>
        </div>
      ) : (
        <div className="form-card" style={{ maxWidth: 640 }}>
          <div className="toggle-row" style={{ marginBottom: 18 }}>
            <div className="t-label">
              <b>Verify your identity &amp; driver&apos;s licence</b>
              <span>Takes about 2 minutes. Required before your first self-drive trip</span>
            </div>
            <span
              className="status-pill pending"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
            >
              {status === 'pending' ? 'In review' : status === 'declined' ? 'Declined' : 'Not verified'}
            </span>
          </div>

          {status === 'declined' && (
            <div className="notice" style={{ marginTop: 0 }}>
              Your last attempt was declined
              {kyc?.decision_reason ? `: ${kyc.decision_reason}` : '.'} You can try again below.
            </div>
          )}

          {status === 'pending' && !session && (
            <div className="notice" style={{ marginTop: 0 }}>
              Your verification is being reviewed. This page updates automatically.
            </div>
          )}

          {/* Optional: confirm government ID to prefill the profile */}
          {!session && (
            <>
              <div className="field">
                <label>
                  Confirm your ID <span className="choose-hint">optional prefill</span>
                </label>
                <div className="two-col">
                  <div className="control">
                    <select value={idType} onChange={(e) => setIdType(e.target.value)}>
                      {ID_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="control">
                    <input
                      placeholder="ID number"
                      value={idNumber}
                      onChange={(e) => setIdNumber(e.target.value)}
                    />
                  </div>
                </div>
                {lookup ? (
                  <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--success)', fontWeight: 700, marginTop: 10 }}>
                    <CheckIcon size={13} /> Confirmed: {lookup.verified_name}
                  </p>
                ) : (
                  <button
                    className="btn-secondary"
                    style={{ marginTop: 'var(--sp-3)' }}
                    disabled={lookupBusy || !idNumber.trim()}
                    onClick={confirmId}
                  >
                    {lookupBusy ? 'Checking…' : 'Confirm ID'}
                  </button>
                )}
                {lookupError && (
                  <p style={{ color: 'var(--error)', fontSize: 'var(--fs-sm)', fontWeight: 700, marginTop: 10 }}>
                    {lookupError}
                  </p>
                )}
              </div>

              <button
                className="btn-primary btn-block"
                disabled={starting}
                onClick={startVerification}
              >
                {starting
                  ? 'Preparing verification…'
                  : status === 'pending'
                    ? 'Restart verification'
                    : 'Start verification'}
              </button>
            </>
          )}

          {session && (
            <div className="kyc-verify">
              <div className="kyc-qr">
                {!qrFailed ? (
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=440x440&data=${encodeURIComponent(
                      session.url
                    )}`}
                    alt="Scan to verify on your phone"
                    onError={() => setQrFailed(true)}
                  />
                ) : (
                  <IdCardIcon size={44} style={{ color: 'var(--hint)' }} />
                )}
              </div>
              <div className="kyc-steps">
                <b>Scan with your phone camera</b>
                <p>
                  You&apos;ll scan your driver&apos;s licence and take a quick selfie video to
                  confirm it&apos;s really you.
                </p>
                <a
                  href={session.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-secondary"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-2)' }}
                >
                  <PhoneIcon size={15} /> On this phone? Verify now
                </a>
                <p className="kyc-waiting">
                  <ShieldIcon size={13} /> Waiting for your verification… this page updates
                  automatically.
                </p>
              </div>
            </div>
          )}

          {error && (
            <p style={{ color: 'var(--error)', fontSize: 'var(--fs-sm)', fontWeight: 700, marginTop: 14 }}>
              {error}
            </p>
          )}

          <div className="notice" style={{ marginTop: 18 }}>
            {uploaded ? (
              <>
                A licence document is already on file from the app.{' '}
                <a className="link" href={user.licenseDocumentUrl} target="_blank" rel="noreferrer">
                  View document
                </a>
                . Verifying here adds the liveness check hosts trust most.
              </>
            ) : (
              <>Verification is powered by Dojah and syncs with the Ardena app.</>
            )}
          </div>
        </div>
      )}
    </AccountLayout>
  );
}
