import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { formatKES, formatDateLong } from '../data.js';
import { SingleDateCalendar } from '../Calendar.jsx';
import {
  mapBooking,
  useCar,
  useCarRatings,
  ratingLabel,
  hostingDuration,
  useHostAvatar,
} from '../cars.js';
import { CarPhoto, BackButton } from '../components.jsx';
import { useToast } from '../toast.jsx';
import {
  getBooking,
  cancelBooking,
  getCancellationPreview,
  downloadReceipt,
  getHandoverCodes,
  refreshHandoverCode,
  listExtensions,
  requestExtension,
  payExtension,
  listPaymentMethods,
  addMpesaMethod,
  getPaymentStatus,
  payBookingBalance,
  markBalancePaidToHost,
  reportHandoverProblem,
} from '../api.js';
import {
  ensureMpesaMethod,
  defaultMpesaNumber,
  pollPayment,
  openPaystack,
  onPaymentReturn,
  MPESA_POLL_TRIES,
  CARD_POLL_TRIES,
} from '../payments.js';
import {
  CalendarIcon,
  MapPinIcon,
  SteeringIcon,
  CreditCardIcon,
  ShieldIcon,
  ChatIcon,
  StarIcon,
  PhoneIcon,
  CheckIcon,
  ClockIcon,
  CopyIcon,
  RefreshIcon,
  CarIcon,
  FlagIcon,
} from '../icons.jsx';

const DEPOSIT_STATUS_LABEL = {
  held: 'held until after the trip',
  pending_release: 'being released',
  released: 'refunded',
  partial_refund: 'partially refunded',
  forfeited: 'forfeited',
};

function fmtBookedOn(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('en-KE', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function fmtUnlockTime(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleString('en-KE', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** One handover phase tile: big code + copy + "new code", or the locked/used state. */
function HandoverPhase({ label, hint, phase, accent, onRefresh, refreshing }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(phase.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable — code is visible anyway */
    }
  };

  return (
    <div className={`handover-tile ${accent}`}>
      <span className="handover-label">
        <i className="handover-dot" /> {label}
      </span>
      {phase.state === 'available' && phase.code ? (
        <>
          <b className="handover-big">
            {phase.code.slice(0, 3)} {phase.code.slice(3)}
          </b>
          <div className="handover-actions">
            <button className="handover-link" onClick={copy}>
              {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />} {copied ? 'Copied' : 'Copy'}
            </button>
            <button className="handover-link" onClick={onRefresh} disabled={refreshing}>
              <RefreshIcon size={13} /> {refreshing ? 'Getting…' : 'New code'}
            </button>
          </div>
        </>
      ) : phase.state === 'awaiting_balance' ? (
        <b className="handover-state">
          <ClockIcon size={15} /> After the balance is paid
        </b>
      ) : phase.state === 'used' ? (
        <b className="handover-state used">
          <CheckIcon size={15} /> Used
        </b>
      ) : (
        <b className="handover-state">
          <ClockIcon size={15} />{' '}
          {phase.unlocks_at ? `Unlocks ${fmtUnlockTime(phase.unlocks_at)}` : hint}
        </b>
      )}
    </div>
  );
}

/**
 * Two-sided handover codes, shown for upcoming/active trips (same as the app).
 * Pickup code unlocks 24h before pickup; return code unlocks once the trip is
 * active. "New code" invalidates the previous one server-side.
 */
function HandoverCard({ bookingId, codes, setCodes }) {
  const [refreshing, setRefreshing] = useState('');
  const [error, setError] = useState('');

  if (!codes || !codes.requires_handover_code) return null;
  const awaitingBalance = codes.pickup?.state === 'awaiting_balance';

  const refresh = async (phase) => {
    if (refreshing) return;
    setRefreshing(phase);
    setError('');
    try {
      const result = await refreshHandoverCode(bookingId, phase);
      setCodes((prev) => {
        const key = phase === 'pickup' ? 'pickup' : 'return';
        return { ...prev, [key]: { ...prev[key], state: result.state, code: result.code } };
      });
    } catch (e) {
      setError(e.message || 'Couldn’t get a new code. Please try again.');
    } finally {
      setRefreshing('');
    }
  };

  return (
    <div className="section">
      <h2>Handover codes</h2>
      <div className="handover-grid">
        <HandoverPhase
          label="Pickup code"
          hint="Unlocks 24h before pickup"
          phase={codes.pickup}
          accent="pickup"
          onRefresh={() => refresh('pickup')}
          refreshing={refreshing === 'pickup'}
        />
        <HandoverPhase
          label="Return code"
          hint="Unlocks once you pick up the car"
          phase={codes.return}
          accent="return"
          onRefresh={() => refresh('return')}
          refreshing={refreshing === 'return'}
        />
      </div>
      <p className="info-note" style={{ paddingTop: 'var(--sp-3)' }}>
        {awaitingBalance ? (
          <>Your pickup code appears once the balance is paid.</>
        ) : (
          <>
            Give the pickup code to your host when collecting the car, and the return code when
            you bring it back — same codes as in the app. Getting a new code cancels the old one.
          </>
        )}
      </p>
      {error && <p className="info-note" style={{ color: 'var(--error)' }}>{error}</p>}
    </div>
  );
}

// ---------- delivery ----------

/** Small map of the delivery address when the booking has coordinates. */
function DeliveryMap({ delivery }) {
  const { latitude: lat, longitude: lng } = delivery;
  if (lat == null || lng == null) return null;
  const d = 0.01;
  const bbox = `${lng - d},${lat - d},${lng + d},${lat + d}`;
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(
    bbox
  )}&layer=mapnik&marker=${lat},${lng}`;
  return (
    <div className="pickup-map trip-map">
      <iframe title="Delivery address map" src={src} loading="lazy" />
    </div>
  );
}

// ---------- pay on pickup ----------

/**
 * Pay-on-pickup balance: what's left to pay, and the three things the renter
 * can do once they're with the car (pay here, say they paid the host, or
 * report a problem). The pickup code only appears once the balance is settled.
 */
function PayOnPickupCard({ booking, balance, onCodes, onPaid, onProblem }) {
  const [mode, setMode] = useState(''); // '' | pay | host | problem
  const [method, setMethod] = useState('mpesa');
  const [phone, setPhone] = useState('');
  const [phase, setPhase] = useState('idle'); // idle | working | waiting
  const [message, setMessage] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const cancelled = React.useRef(false);
  const wake = React.useRef(null);

  useEffect(() => {
    cancelled.current = false;
    defaultMpesaNumber().then((n) => {
      if (n) setPhone((p) => p || n);
    });
    const off = onPaymentReturn(() => wake.current && wake.current());
    return () => {
      cancelled.current = true;
      off();
    };
  }, []);

  const amount = formatKES(balance.balance_amount);

  if (balance.balance_status !== 'pending') {
    return (
      <div className="section">
        <h2>Pay on pickup</h2>
        <div className="info-card">
          <div className="info-row">
            <span>
              <CheckIcon size={17} style={{ color: 'var(--success)' }} />{' '}
              {balance.balance_status === 'paid_to_host'
                ? 'You paid the host at pickup'
                : 'Balance paid'}
            </span>
            <b>{amount}</b>
          </div>
        </div>
      </div>
    );
  }

  const choose = (next) => {
    setMode((m) => (m === next ? '' : next));
    setError('');
    setNote('');
  };

  const payHere = async () => {
    if (phase !== 'idle') return;
    setError('');
    setNote('');
    setPhase('working');
    try {
      const methodId = method === 'mpesa' ? await ensureMpesaMethod(phone) : null;
      const result = await payBookingBalance(booking.id, methodId);
      let params;
      if (method === 'mpesa') {
        setNote('STK push sent. Enter your M-Pesa PIN on your phone to pay.');
        params = { checkout_request_id: result.checkout_request_id };
      } else {
        if (!result.redirect_url) throw new Error('Card payment could not be started.');
        if (!openPaystack(result.redirect_url)) return;
        setNote('Complete the card payment in the Paystack tab. We’ll confirm here.');
        params = { paystack_reference: result.paystack_reference };
      }
      setPhase('waiting');
      const status = await pollPayment(params, {
        tries: method === 'mpesa' ? MPESA_POLL_TRIES : CARD_POLL_TRIES,
        isCancelled: () => cancelled.current,
        wake,
      });
      if (!status) return;
      if (status.status === 'completed') {
        setNote('');
        setMode('');
        onPaid();
        return;
      }
      throw new Error(
        status.status === 'timeout'
          ? 'We haven’t received the payment confirmation yet. You can try again.'
          : status.message || `Payment ${status.status}. You can try again.`
      );
    } catch (e) {
      if (cancelled.current) return;
      setNote('');
      setError(e.message || 'Payment failed. Please try again.');
    } finally {
      if (!cancelled.current) setPhase('idle');
    }
  };

  const paidHost = async () => {
    if (phase !== 'idle') return;
    setError('');
    setPhase('working');
    try {
      // The response is the handover-codes object: the pickup code shows at once.
      onCodes(await markBalancePaidToHost(booking.id));
      setMode('');
      onPaid();
    } catch (e) {
      setError(e.message || 'Couldn’t confirm that. Please try again.');
    } finally {
      setPhase('idle');
    }
  };

  const sendProblem = async () => {
    if (phase !== 'idle' || message.trim().length < 5) return;
    setError('');
    setPhase('working');
    try {
      const fresh = await reportHandoverProblem(booking.id, message.trim());
      if (fresh && fresh.booking_id) onProblem(fresh);
      setMessage('');
      setMode('');
      setNote('done');
    } catch (e) {
      setError(e.message || 'Couldn’t send that. Please try again.');
    } finally {
      setPhase('idle');
    }
  };

  const busy = phase !== 'idle';

  return (
    <div className="section">
      <h2>Pay on pickup</h2>
      <div className="info-card">
        <div className="info-row">
          <span>
            <CreditCardIcon size={17} /> Left to pay at pickup
          </span>
          <b style={{ fontSize: 'var(--fs-md)' }}>{amount} to pay at pickup</b>
        </div>
        <p className="info-note">
          When you’re with the car and happy with it, settle the balance. Your pickup code appears
          once it’s paid.
        </p>

        {balance.problem_reported && (
          <p className="info-note" style={{ color: 'var(--warning)', fontWeight: 700 }}>
            You reported a problem with the car. Ardena support is on it; don’t pay until it’s
            sorted.
          </p>
        )}
        {note === 'done' && (
          <p className="info-note" style={{ color: 'var(--success)', fontWeight: 700 }}>
            Sent. We’ve told your host and opened a chat with Ardena support.{' '}
            <Link to="/messages" state={{ hostId: 'support' }} className="link">
              Open the chat
            </Link>
          </p>
        )}

        <div className="balance-actions">
          {balance.can_pay_balance_in_app && (
            <button
              className={`choice-btn${mode === 'pay' ? ' selected' : ''}`}
              onClick={() => choose('pay')}
              disabled={busy}
            >
              <CreditCardIcon size={16} /> Pay the rest here
            </button>
          )}
          <button
            className={`choice-btn${mode === 'host' ? ' selected' : ''}`}
            onClick={() => choose('host')}
            disabled={busy}
          >
            <CheckIcon size={16} /> I’ve received the car and paid the host
          </button>
          <button
            className={`choice-btn${mode === 'problem' ? ' selected' : ''}`}
            onClick={() => choose('problem')}
            disabled={busy}
          >
            <FlagIcon size={16} /> Problem with the car
          </button>
        </div>

        {mode === 'pay' && (
          <div className="balance-panel">
            <div className="seg">
              <button
                className={`choice-btn${method === 'mpesa' ? ' selected' : ''}`}
                onClick={() => setMethod('mpesa')}
                disabled={busy}
              >
                <span className="radio-dot" />
                <PhoneIcon size={16} /> M-Pesa
              </button>
              <button
                className={`choice-btn${method === 'card' ? ' selected' : ''}`}
                onClick={() => setMethod('card')}
                disabled={busy}
              >
                <span className="radio-dot" />
                <CreditCardIcon size={16} /> Card
              </button>
            </div>
            <div className="ext-pay">
              {method === 'mpesa' && (
                <div className="ext-phone">
                  <PhoneIcon size={16} />
                  <input
                    type="tel"
                    placeholder="07XX XXX XXX"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    disabled={busy}
                  />
                </div>
              )}
              <button className="btn-primary ext-pay-btn" onClick={payHere} disabled={busy}>
                {phase === 'working'
                  ? 'Starting…'
                  : phase === 'waiting'
                    ? 'Waiting for payment…'
                    : `Pay ${amount}`}
              </button>
            </div>
          </div>
        )}

        {mode === 'host' && (
          <div className="balance-panel">
            <p className="info-note" style={{ paddingTop: 0 }}>
              Only tap this once you’ve paid the host <b>{amount}</b>. Your pickup code shows
              straight away.
            </p>
            <div className="cancel-confirm" style={{ flexWrap: 'wrap' }}>
              <button className="btn-primary" onClick={paidHost} disabled={busy}>
                {busy ? 'Confirming…' : `Yes, I paid the host ${amount}`}
              </button>
              <button className="btn-secondary" onClick={() => setMode('')} disabled={busy}>
                Not yet
              </button>
            </div>
          </div>
        )}

        {mode === 'problem' && (
          <div className="balance-panel">
            <p className="info-note" style={{ paddingTop: 0 }}>
              Tell us what’s wrong. We’ll tell your host and open a chat with Ardena support.
              Don’t pay the balance.
            </p>
            <div className="control" style={{ height: 'auto' }}>
              <textarea
                rows={3}
                maxLength={2000}
                placeholder="e.g. The car has a flat tyre and the fuel tank is empty"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                disabled={busy}
              />
            </div>
            <button
              className="btn-primary"
              style={{ marginTop: 'var(--sp-3)' }}
              onClick={sendProblem}
              disabled={busy || message.trim().length < 5}
            >
              {busy ? 'Sending…' : 'Report the problem'}
            </button>
          </div>
        )}

        {note && note !== 'done' && (
          <p className="info-note" style={{ color: 'var(--success)', fontWeight: 700 }}>
            {note}
          </p>
        )}
        {error && (
          <p className="info-note" style={{ color: 'var(--error)', fontWeight: 700 }}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

// ---------- trip extensions ----------

const EXT_STATUS = {
  pending_host_approval: { pill: 'pending', label: 'awaiting host' },
  host_approved: { pill: 'confirmed', label: 'approved' },
  paid: { pill: 'active', label: 'paid' },
  rejected: { pill: 'rejected', label: 'rejected' },
  expired: { pill: 'cancelled', label: 'expired' },
};

const EXT_POLL_INTERVAL_MS = 3500;
const EXT_POLL_TRIES = 40; // ~2.3 minutes of STK polling

function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.startsWith('254')) return digits;
  if (digits.startsWith('0')) return '254' + digits.slice(1);
  return '254' + digits;
}

/** Adds `days` to a YYYY-MM-DD string (local time — toISOString would shift a day in UTC+3). */
function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function daysBetween(fromStr, toStr) {
  return Math.round(
    (new Date(toStr + 'T00:00:00') - new Date(fromStr + 'T00:00:00')) / 86_400_000
  );
}

/**
 * Keep-the-car-longer flow: request a later drop-off → host approves →
 * pay the extra days by M-Pesa (must be 24h+ before the current drop-off).
 */
function ExtendTripCard({ booking, onBookingUpdate }) {
  const [extensions, setExtensions] = useState(null);
  const [newDate, setNewDate] = useState('');
  const [calOpen, setCalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [phone, setPhone] = useState('');
  const [payPhase, setPayPhase] = useState('idle'); // idle | working | waiting
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const reload = () =>
    listExtensions(booking.id)
      .then((data) => setExtensions(data.extensions || []))
      .catch(() => setExtensions([]));

  useEffect(() => {
    let on = true;
    listExtensions(booking.id)
      .then((data) => {
        if (on) setExtensions(data.extensions || []);
      })
      .catch(() => {
        if (on) setExtensions([]);
      });
    return () => {
      on = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking.id]);

  useEffect(() => {
    // Prefill with the client's default M-Pesa number for the approved-extension payment.
    listPaymentMethods()
      .then((data) => {
        const methods = data?.payment_methods || data?.methods || data || [];
        const mpesa = Array.isArray(methods)
          ? methods.filter((m) => m.method_type === 'mpesa')
          : [];
        const preferred = mpesa.find((m) => m.is_default) || mpesa[0];
        if (preferred?.mpesa_number) setPhone(preferred.mpesa_number);
      })
      .catch(() => {});
  }, []);

  if (extensions === null) return null;

  const active = extensions.find((e) =>
    ['pending_host_approval', 'host_approved'].includes(e.status)
  );
  const history = extensions.filter((e) => e !== active);

  const minDate = addDays(booking.dropoffDate, 1);
  const extraDays = newDate ? Math.max(0, daysBetween(booking.dropoffDate, newDate)) : 0;
  const perDay = booking.dailyRate + (booking.damageWaiver ? booking.waiver / booking.days : 0);
  const estimate = extraDays * perDay;

  const submitRequest = async () => {
    if (submitting || !newDate || extraDays < 1) return;
    setSubmitting(true);
    setError('');
    setNote('');
    try {
      // Keep the original drop-off time so the backend counts whole extra days.
      const time = String(booking.endsAtISO || '').slice(11, 19) || '10:00:00';
      await requestExtension(booking.id, `${newDate}T${time}`);
      setNewDate('');
      setNote('Extension requested — we’ll notify you when the host responds.');
      await reload();
    } catch (e) {
      setError(e.message || 'Couldn’t request the extension. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const payApproved = async () => {
    if (payPhase !== 'idle' || !active) return;
    setError('');
    setNote('');
    setPayPhase('working');
    try {
      const number = normalizePhone(phone);
      if (number.length < 12) throw new Error('Enter a valid M-Pesa number.');
      const data = await listPaymentMethods().catch(() => null);
      const methods = data?.payment_methods || data?.methods || data || [];
      const match = Array.isArray(methods)
        ? methods.find(
            (m) => m.method_type === 'mpesa' && normalizePhone(m.mpesa_number) === number
          )
        : null;
      const methodId = match ? match.id : (await addMpesaMethod('M-Pesa', number)).id;

      const result = await payExtension(booking.id, active.id, methodId);
      setPayPhase('waiting');
      setNote('STK push sent. Enter your M-Pesa PIN on your phone to pay.');

      for (let i = 0; i < EXT_POLL_TRIES; i++) {
        await new Promise((r) => setTimeout(r, EXT_POLL_INTERVAL_MS));
        let status;
        try {
          status = await getPaymentStatus({ checkout_request_id: result.transaction_id });
        } catch {
          continue; // transient — keep polling
        }
        if (status.status === 'completed') {
          setNote('Extension paid — your drop-off has been moved.');
          setPayPhase('idle');
          await reload();
          const fresh = await getBooking(booking.id).catch(() => null);
          if (fresh) onBookingUpdate(fresh);
          return;
        }
        if (status.status === 'failed' || status.status === 'cancelled') {
          throw new Error(status.message || `Payment ${status.status}. You can try again.`);
        }
      }
      throw new Error('We haven’t received the payment confirmation yet. You can try again.');
    } catch (e) {
      setNote('');
      setError(e.message || 'Payment failed. Please try again.');
      setPayPhase('idle');
    }
  };

  const extRow = (e) => {
    const s = EXT_STATUS[e.status] || { pill: 'pending', label: e.status };
    return (
      <div className="info-row" key={e.id}>
        <span>
          <CalendarIcon size={17} /> Until {formatDateLong(String(e.requested_end_date).slice(0, 10))} ·{' '}
          {e.extra_days} extra day{e.extra_days === 1 ? '' : 's'}
        </span>
        <b>
          {formatKES(e.extra_amount)} <span className={`status-pill ${s.pill}`}>{s.label}</span>
        </b>
      </div>
    );
  };

  return (
    <div className="section">
      <h2>Keep the car longer</h2>
      <div className="info-card">
        {active && extRow(active)}
        {history.map(extRow)}

        {active?.status === 'pending_host_approval' && (
          <p className="info-note">
            Waiting for your host to approve. You’ll pay {formatKES(active.extra_amount)} once
            they do.
          </p>
        )}

        {active?.status === 'host_approved' && (
          <>
            <div className="ext-pay">
              <div className="ext-phone">
                <PhoneIcon size={16} />
                <input
                  type="tel"
                  placeholder="07XX XXX XXX"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  disabled={payPhase !== 'idle'}
                />
              </div>
              <button
                className="btn-primary ext-pay-btn"
                onClick={payApproved}
                disabled={payPhase !== 'idle'}
              >
                {payPhase === 'working'
                  ? 'Starting…'
                  : payPhase === 'waiting'
                    ? 'Waiting for M-Pesa…'
                    : `Pay ${formatKES(active.extra_amount)}`}
              </button>
            </div>
            <p className="info-note">
              Host approved! Pay by M-Pesa at least 24 hours before your current drop-off to
              confirm the extra days.
            </p>
          </>
        )}

        {!active && (
          <>
            <div className="ext-pay">
              <button
                className="ext-date-btn"
                onClick={() => setCalOpen((v) => !v)}
                disabled={submitting}
              >
                <CalendarIcon size={16} />
                {newDate ? `New drop-off · ${formatDateLong(newDate)}` : 'Pick a new drop-off date'}
              </button>
              <button
                className="btn-primary ext-pay-btn"
                onClick={submitRequest}
                disabled={submitting || !newDate || extraDays < 1}
              >
                {submitting
                  ? 'Requesting…'
                  : extraDays >= 1
                    ? `Request ${extraDays} extra day${extraDays === 1 ? '' : 's'} · ${formatKES(estimate)}`
                    : 'Request extension'}
              </button>
            </div>
            {calOpen && (
              <div className="ext-cal">
                <SingleDateCalendar
                  value={newDate}
                  minDate={minDate}
                  onChange={(d) => {
                    setNewDate(d);
                    setCalOpen(false);
                  }}
                />
              </div>
            )}
            <p className="info-note">
              Pick a new drop-off date. Your host approves first, then you pay{' '}
              {formatKES(perDay)}/day for the extra days — same rate as this trip.
            </p>
          </>
        )}

        {note && (
          <p className="info-note" style={{ color: 'var(--success)', fontWeight: 700 }}>
            {note}
          </p>
        )}
        {error && (
          <p className="info-note" style={{ color: 'var(--error)', fontWeight: 700 }}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

export default function TripDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelPreview, setCancelPreview] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelNote, setCancelNote] = useState('');
  const [receiptBusy, setReceiptBusy] = useState(false);
  const [error, setError] = useState('');
  const [codes, setCodes] = useState(null);
  const status = booking?.status;

  // Handover codes (the pay-on-pickup actions below update them too).
  useEffect(() => {
    if (!['pending', 'confirmed', 'active'].includes(status)) return undefined;
    let on = true;
    getHandoverCodes(id)
      .then((data) => {
        if (on) setCodes(data);
      })
      .catch(() => {});
    return () => {
      on = false;
    };
  }, [id, status]);

  const reloadBooking = () =>
    getBooking(id)
      .then((data) => setBooking(mapBooking(data)))
      .catch(() => {});
  const reloadCodes = () =>
    getHandoverCodes(id)
      .then(setCodes)
      .catch(() => {});

  useEffect(() => {
    let on = true;
    getBooking(id)
      .then((data) => {
        if (on) setBooking(mapBooking(data));
      })
      .catch(() => {})
      .finally(() => {
        if (on) setLoading(false);
      });
    return () => {
      on = false;
    };
  }, [id]);

  // Live listing — brings the host avatar/joined-year and current price for rebooking.
  const { car: liveCar } = useCar(booking?.car.id || '');
  const ratings = useCarRatings(booking?.car.id || '');
  const hostAvatar = useHostAvatar(
    liveCar?.host.id || booking?.car.host.id,
    liveCar?.host.avatarUrl
  );

  if (loading) {
    return (
      <div className="page trip-detail">
        <div className="container">
          <div className="details-layout" style={{ marginTop: 26 }} aria-hidden="true">
            <div>
              <div className="trip-head dashed-card" style={{ gap: 20 }}>
                <div className="skel-circle" style={{ width: 88, height: 88 }} />
                <div style={{ flex: 1 }}>
                  <div className="skel-line" style={{ width: '45%', height: 24, marginTop: 0 }} />
                  <div className="skel-line" style={{ width: '30%', height: 13 }} />
                </div>
              </div>
              {Array.from({ length: 2 }, (_, i) => (
                <div className="section" key={i}>
                  <div className="skel-line" style={{ width: '30%', height: 18, marginTop: 0 }} />
                  <div
                    className="skel-line"
                    style={{ width: '100%', height: 120, borderRadius: 0, marginTop: 14 }}
                  />
                </div>
              ))}
            </div>
            <aside>
              <div
                className="skel-line"
                style={{ width: '100%', height: 260, borderRadius: 0, marginTop: 0 }}
              />
            </aside>
          </div>
        </div>
      </div>
    );
  }

  if (!booking) {
    return (
      <div className="page container">
        <div className="empty">
          Trip not found. <Link to="/trips">Back to my trips</Link>
        </div>
      </div>
    );
  }

  const photos = booking.car.photos.length ? booking.car.photos : liveCar?.photos || [];
  const galleryCar = { ...booking.car, photos };
  const host = liveCar?.host || booking.car.host;
  const hostFirstName = host.name.split(' ')[0];
  const hosting = hostingDuration(liveCar?.host.createdAt);
  const balance = booking.paymentMode === 'pay_on_pickup' ? booking.payOnPickup : null;
  // Once the renter has paid the host in person, cancelling is support's job (API: 409).
  const paidHost = balance?.balance_status === 'paid_to_host';
  const cancellable = ['pending', 'confirmed'].includes(booking.status) && !paidHost;
  const paid = ['confirmed', 'active', 'completed'].includes(booking.status);
  const bookedOn = fmtBookedOn(booking.createdAt);
  const depositLabel = DEPOSIT_STATUS_LABEL[booking.depositStatus];

  const messageHost = () =>
    navigate('/messages', {
      state: {
        hostId: host.id || booking.car.host.id,
        hostName: host.name,
        carName: booking.car.name,
      },
    });

  // Fetch the live refund preview when the confirm box opens — the widget then
  // shows the exact amount instead of the generic policy line.
  const openCancel = () => {
    setConfirmCancel(true);
    setCancelPreview(null);
    getCancellationPreview(booking.id)
      .then(setCancelPreview)
      .catch(() => setCancelPreview(false));
  };

  const doCancel = async () => {
    if (cancelling) return;
    setCancelling(true);
    setError('');
    try {
      const result = await cancelBooking(booking.id);
      setBooking(mapBooking(result));
      setConfirmCancel(false);
      if (result.refund_eligible && result.refund_amount > 0) {
        setCancelNote(
          `Trip cancelled. A refund of ${formatKES(result.refund_amount)} is on its way.`
        );
      } else {
        setCancelNote('Trip cancelled.');
      }
      toast.success('Trip cancelled');
    } catch (e) {
      setError(e.message || 'Couldn’t cancel the trip. Please try again.');
      toast.error('Couldn’t cancel the trip');
    } finally {
      setCancelling(false);
    }
  };

  const getReceipt = async () => {
    if (receiptBusy) return;
    setReceiptBusy(true);
    setError('');
    try {
      await downloadReceipt(booking.id);
    } catch (e) {
      setError(e.message || 'Couldn’t download the receipt. Please try again.');
    } finally {
      setReceiptBusy(false);
    }
  };

  return (
    <div className="page trip-detail">
      <div className="container">
        <BackButton to="/trips" />

        <div className="details-layout" style={{ marginTop: 26 }}>
          <div>
            <div className="trip-head dashed-card">
              <CarPhoto car={galleryCar} className="trip-head-pic" />
              <div className="trip-head-main">
                <div className="trip-title" style={{ gap: 14 }}>
                  <h1 className="page-title" style={{ marginBottom: 0 }}>
                    {booking.car.name}
                  </h1>
                  <span className={`status-pill ${booking.status}`}>{booking.status}</span>
                </div>
                <div className="rating-line" style={{ marginTop: 6 }}>
                  <span className="trip-code">{booking.id}</span>
                  {bookedOn && <> · Booked on {bookedOn}</>}
                </div>
              </div>
            </div>

            {cancelNote && (
              <div className="notice" style={{ marginTop: 'var(--sp-4)' }}>
                {cancelNote}
              </div>
            )}
            {booking.status === 'cancelled' && !cancelNote && (
              <div className="notice" style={{ marginTop: 'var(--sp-4)' }}>
                This trip was cancelled
                {booking.cancellationReason ? ` — ${booking.cancellationReason}` : '.'}
                {booking.refundPolicyReason ? ` ${booking.refundPolicyReason}` : ''}
              </div>
            )}

            <div className="section">
              <h2>Trip details</h2>
              <div className="info-card">
                <div className="info-row">
                  <span>
                    <CalendarIcon size={17} /> Pickup
                  </span>
                  <b>
                    {formatDateLong(booking.pickupDate)}
                    {booking.pickupTime ? ` · ${booking.pickupTime}` : ''}
                  </b>
                </div>
                <div className="info-row">
                  <span>
                    <CalendarIcon size={17} /> Drop-off
                  </span>
                  <b>
                    {formatDateLong(booking.dropoffDate)}
                    {booking.dropoffTime ? ` · ${booking.dropoffTime}` : ''}
                  </b>
                </div>
                {booking.delivery ? (
                  <>
                    <div className="info-row">
                      <span>
                        <CarIcon size={17} /> Delivered to
                      </span>
                      <b>{booking.delivery.address}</b>
                    </div>
                    <div className="info-row">
                      <span>
                        <MapPinIcon size={17} /> Collected from
                      </span>
                      <b>{booking.delivery.address}</b>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="info-row">
                      <span>
                        <MapPinIcon size={17} /> Pickup point
                      </span>
                      <b>{booking.pickupLocation}</b>
                    </div>
                    <div className="info-row">
                      <span>
                        <MapPinIcon size={17} /> Return point
                      </span>
                      <b>{booking.dropoffLocation}</b>
                    </div>
                  </>
                )}
                <div className="info-row">
                  <span>
                    <SteeringIcon size={17} /> Drive type
                  </span>
                  <b>{booking.driveType === 'self' ? 'Self drive' : 'Chauffeur'}</b>
                </div>
                {booking.checkIn && (
                  <div className="info-row">
                    <span>
                      <PhoneIcon size={17} /> Check-in
                    </span>
                    <b>{booking.checkIn === 'self' ? 'Self check-in' : 'Assisted by host'}</b>
                  </div>
                )}
                {booking.notes && (
                  <p className="info-note">Special requirements: {booking.notes}</p>
                )}
                {booking.delivery && <DeliveryMap delivery={booking.delivery} />}
              </div>
            </div>

            {balance && ['confirmed', 'active'].includes(booking.status) && (
              <PayOnPickupCard
                booking={booking}
                balance={balance}
                onCodes={setCodes}
                onPaid={() => {
                  reloadBooking();
                  reloadCodes();
                }}
                onProblem={(fresh) => setBooking(mapBooking(fresh))}
              />
            )}

            {['pending', 'confirmed', 'active'].includes(booking.status) && (
              <HandoverCard bookingId={booking.id} codes={codes} setCodes={setCodes} />
            )}

            {['confirmed', 'active'].includes(booking.status) && (
              <ExtendTripCard
                booking={booking}
                onBookingUpdate={(fresh) => setBooking(mapBooking(fresh))}
              />
            )}

            <div className="section host-duo">
              <div>
                <h2>Your host</h2>
                <div className="host-panel">
                  <span className="avatar" style={{ width: 68, height: 68, fontSize: 'var(--fs-2xl)' }}>
                    {hostAvatar ? <img src={hostAvatar} alt={host.name} /> : host.name[0]}
                  </span>
                  <b className="host-name">{host.name}</b>
                  {host.joined && <span className="car-meta">Host since {host.joined}</span>}
                  <div className="host-stats">
                    <div>
                      <b>
                        {liveCar ? ratingLabel(liveCar) : '—'} <StarIcon size={12} />
                      </b>
                      <span>Rating</span>
                    </div>
                    <div>
                      <b>{ratings.total}</b>
                      <span>Reviews</span>
                    </div>
                    <div>
                      <b>{hosting || '—'}</b>
                      <span>Hosting</span>
                    </div>
                  </div>
                  <button className="btn-secondary host-msg" disabled={!paid} onClick={messageHost}>
                    <ChatIcon size={16} /> Message {hostFirstName}
                  </button>
                  {!paid && (
                    <span className="host-msg-hint">Unlocks once the booking is paid</span>
                  )}
                </div>
              </div>

              <div>
                <h2>About this host</h2>
                <div className="host-about">
                  <p>
                    {hostFirstName} is an Ardena host{liveCar?.city ? ` in ${liveCar.city}` : ''}.
                    Ardena hosts respond in under 30 minutes on average and are identity-verified
                    before their cars go live.
                  </p>
                  <p>
                    Your payment is held securely by Ardena and only released to the host after
                    pickup, with 24/7 support throughout your trip.
                  </p>
                </div>
              </div>
            </div>

            <div className="section">
              <h2>Payment</h2>
              <div className="info-card">
                <div className="info-row">
                  <span>
                    <CreditCardIcon size={17} /> {formatKES(booking.dailyRate)} × {booking.days}{' '}
                    day{booking.days === 1 ? '' : 's'}
                  </span>
                  <b>{formatKES(booking.subtotal)}</b>
                </div>
                {booking.damageWaiver && (
                  <div className="info-row">
                    <span>
                      <ShieldIcon size={17} /> Damage waiver
                    </span>
                    <b>{formatKES(booking.waiver)}</b>
                  </div>
                )}
                {booking.deposit > 0 && (
                  <div className="info-row">
                    <span>
                      <ShieldIcon size={17} /> Deposit{depositLabel ? ` (${depositLabel})` : ''}
                    </span>
                    <b>{formatKES(booking.deposit)}</b>
                  </div>
                )}
                {booking.delivery && (
                  <div className="info-row">
                    <span>
                      <CarIcon size={17} /> Delivery &amp; collection
                    </span>
                    <b>{booking.deliveryFee > 0 ? formatKES(booking.deliveryFee) : 'Free'}</b>
                  </div>
                )}
                <div className="info-row">
                  <span>Total</span>
                  <b style={{ fontSize: 'var(--fs-md)' }}>{formatKES(booking.total)}</b>
                </div>
                {balance && (
                  <>
                    <div className="info-row">
                      <span>Paid when booking</span>
                      <b>{formatKES(balance.upfront_amount)}</b>
                    </div>
                    <div className="info-row">
                      <span>
                        {balance.balance_status === 'pending' ? 'To pay at pickup' : 'Paid at pickup'}
                      </span>
                      <b>{formatKES(balance.balance_amount)}</b>
                    </div>
                  </>
                )}
                {booking.depositStatus === 'partial_refund' && booking.depositRefunded != null && (
                  <p className="info-note">
                    {formatKES(booking.depositRefunded)} of the deposit was refunded.
                  </p>
                )}
              </div>
            </div>

            {paid && (
              <div className="section">
                <h2>Receipt</h2>
                <div className="info-card receipt-card">
                  <div className="info-row" style={{ borderTop: 'none' }}>
                    <span>
                      <CreditCardIcon size={17} /> PDF with booking, payment and host details
                    </span>
                    <button className="btn-secondary" onClick={getReceipt} disabled={receiptBusy}>
                      {receiptBusy ? 'Preparing…' : 'Download receipt'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div style={{ color: 'var(--error)', fontSize: 'var(--fs-sm)', fontWeight: 700, marginTop: 'var(--sp-4)' }}>
                {error}
              </div>
            )}
          </div>

          <aside className="side-sticky">
            <div className="book-widget rebook-card">
              <CarPhoto car={galleryCar} className="pic" />
              <b className="rebook-name">{booking.car.name}</b>
              {liveCar ? (
                <>
                  <div className="rating-line" style={{ justifyContent: 'center' }}>
                    <StarIcon size={13} /> {ratingLabel(liveCar)} · {liveCar.locationName}
                  </div>
                  <div className="price-line" style={{ marginTop: 10 }}>
                    {formatKES(liveCar.pricePerDay)} <span>/ day</span>
                  </div>
                  <Link to={`/book/${liveCar.id}`} className="btn-primary btn-block">
                    Book again
                  </Link>
                  <Link
                    to={`/cars/${liveCar.id}`}
                    className="link"
                    style={{ fontSize: 'var(--fs-sm)', textAlign: 'center', display: 'block', marginTop: 'var(--sp-3)' }}
                  >
                    View listing
                  </Link>
                </>
              ) : (
                <>
                  <p className="car-meta" style={{ textAlign: 'center', margin: '8px 0 14px' }}>
                    This car is no longer listed.
                  </p>
                  <Link to="/" className="btn-primary btn-block">
                    Browse similar cars
                  </Link>
                </>
              )}
            </div>

            {paidHost && ['confirmed', 'active'].includes(booking.status) && (
              <p className="widget-foot" style={{ marginTop: 20 }}>
                You’ve paid the host, so this trip can’t be cancelled here. Need help?{' '}
                <Link to="/messages" state={{ hostId: 'support' }} className="link">
                  Message Ardena support
                </Link>
              </p>
            )}

            {cancellable && (
              <div className="book-widget" style={{ marginTop: 20 }}>
                {confirmCancel ? (
                  <>
                    <div className="cancel-confirm" style={{ flexWrap: 'wrap', justifyContent: 'center' }}>
                      <span>Cancel this trip?</span>
                      <button className="btn-secondary danger-btn" onClick={doCancel} disabled={cancelling}>
                        {cancelling ? 'Cancelling…' : 'Yes, cancel'}
                      </button>
                      <button
                        className="btn-secondary"
                        onClick={() => setConfirmCancel(false)}
                        disabled={cancelling}
                      >
                        Keep trip
                      </button>
                    </div>
                    <p className="widget-foot" style={{ marginTop: 14 }}>
                      {cancelPreview === null ? (
                        'Checking your refund…'
                      ) : cancelPreview && cancelPreview.refund_eligible && cancelPreview.refund_amount > 0 ? (
                        <>
                          <CheckIcon size={13} style={{ color: 'var(--success)' }} /> You’ll be
                          refunded {formatKES(cancelPreview.refund_amount)}
                          {cancelPreview.refund_percentage != null &&
                            ` (${Math.round(cancelPreview.refund_percentage * 100)}%)`}
                          .
                          {cancelPreview.refund_policy_reason && (
                            <> {cancelPreview.refund_policy_reason}</>
                          )}
                        </>
                      ) : cancelPreview ? (
                        cancelPreview.refund_policy_reason ||
                        'No refund applies if you cancel now.'
                      ) : (
                        'Full refund until 24 hours before pickup, 50% after that.'
                      )}
                    </p>
                  </>
                ) : (
                  <>
                    <button
                      className="btn-secondary danger-btn btn-block"
                      style={{ width: '100%' }}
                      onClick={openCancel}
                    >
                      Cancel trip
                    </button>
                    <p className="widget-foot" style={{ marginTop: 14 }}>
                      <CheckIcon size={13} style={{ color: 'var(--success)' }} /> Full refund until
                      24 hours before pickup, 50% after that.
                    </p>
                  </>
                )}
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
