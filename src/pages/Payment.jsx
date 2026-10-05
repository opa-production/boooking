import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { formatKES, formatDateLong } from '../data.js';
import { CarPhoto, BackButton, MastercardMark, BookingSteps, StickyActionBar } from '../components.jsx';
import mpesaImg from '../assets/mpesa.png';
import payingVideo from '../assets/payment.webm';
import { useApp } from '../store.jsx';
import { useScrollLock } from '../useScrollLock.js';
import * as api from '../api.js';
import { PhoneIcon, CreditCardIcon } from '../icons.jsx';

const POLL_INTERVAL_MS = 3500;
const MPESA_POLL_TRIES = 40; // ~2.3 minutes
const CARD_POLL_TRIES = 120; // ~7 minutes (user is on Paystack's page)

function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.startsWith('254')) return digits;
  if (digits.startsWith('0')) return '254' + digits.slice(1);
  return '254' + digits;
}

export default function Payment() {
  const { state } = useLocation();
  const navigate = useNavigate();
  const { user } = useApp();

  const [method, setMethod] = useState('mpesa');
  const [phone, setPhone] = useState(user?.phone || '');
  // idle | working | waiting (user completing payment) | failed
  const [phase, setPhase] = useState('idle');
  const [statusText, setStatusText] = useState('');
  const [error, setError] = useState('');
  // Booking created on the first attempt and reused on retries.
  const bookingRef = useRef(null);
  const cancelled = useRef(false);

  useEffect(
    () => () => {
      cancelled.current = true;
    },
    []
  );

  // Lock the page behind the processing overlay.
  useScrollLock(phase === 'working' || phase === 'waiting');

  const car = state?.car || null;

  if (!state || !car) {
    return (
      <div className="page container">
        <div className="empty">
          No booking in progress. <Link to="/">Browse cars</Link>
        </div>
      </div>
    );
  }

  const busy = phase === 'working' || phase === 'waiting';
  const payValid = method === 'mpesa' ? phone.replace(/\D/g, '').length >= 9 : true;
  const totalDue = bookingRef.current?.total_price ?? state.total;

  // Shared by the in-card button and the mobile sticky bar so they never drift.
  const payLabel =
    phase === 'working'
      ? 'Starting payment…'
      : phase === 'waiting'
        ? 'Waiting for payment…'
        : phase === 'failed'
          ? `Try again — pay ${formatKES(totalDue)}`
          : `Pay ${formatKES(totalDue)}`;

  const ensureBooking = async () => {
    if (bookingRef.current) return bookingRef.current;
    const booking = await api.createBooking({
      car_id: Number(car.id),
      start_date: `${state.pickupDate}T${state.pickupTime || '10:00'}:00`,
      end_date: `${state.dropoffDate}T${state.dropoffTime || '10:00'}:00`,
      pickup_time: state.pickupTime,
      return_time: state.dropoffTime,
      pickup_location: state.pickupLocation,
      return_location: state.dropoffLocation,
      dropoff_same_as_pickup: state.pickupLocation === state.dropoffLocation,
      damage_waiver_enabled: state.damageWaiver,
      drive_type: state.driveType,
      check_in_preference: state.checkIn,
      special_requirements: state.notes || null,
    });
    bookingRef.current = booking;
    return booking;
  };

  /**
   * M-Pesa: reuse the saved method for this number, otherwise create one.
   * Card: nothing to save — Paystack takes the card on its page — so null,
   * which tells processPayment to send method_type "card".
   */
  const ensureMethod = async () => {
    if (method !== 'mpesa') return null;
    const existing = await api.listPaymentMethods().catch(() => null);
    const methods = existing?.payment_methods || existing?.methods || existing || [];
    const number = normalizePhone(phone);
    const match = Array.isArray(methods)
      ? methods.find((m) => m.method_type === 'mpesa' && normalizePhone(m.mpesa_number) === number)
      : null;
    if (match) return match.id;
    const created = await api.addMpesaMethod('M-Pesa', number);
    return created.id;
  };

  const pollStatus = async (params, tries) => {
    for (let i = 0; i < tries; i++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      if (cancelled.current) return;
      let status;
      try {
        status = await api.getPaymentStatus(params);
      } catch {
        continue; // transient — keep polling
      }
      if (cancelled.current) return;
      if (status.status === 'completed') {
        navigate(`/confirmed/${status.booking_id}`, { replace: true });
        return;
      }
      if (status.status === 'failed' || status.status === 'cancelled') {
        setPhase('failed');
        setError(status.message || `Payment ${status.status}. You can try again.`);
        return;
      }
    }
    setPhase('failed');
    setError('We haven’t received the payment confirmation yet. You can try again.');
  };

  const payNow = async () => {
    if (busy) return;
    setError('');
    setPhase('working');
    setStatusText('Creating your booking…');
    try {
      const booking = await ensureBooking();
      setStatusText('Contacting the payment provider…');
      const methodId = await ensureMethod();
      const result = await api.processPayment(booking.booking_id, methodId);

      if (method === 'mpesa') {
        setPhase('waiting');
        setStatusText('STK push sent. Enter your M-Pesa PIN on your phone to pay.');
        await pollStatus({ checkout_request_id: result.transaction_id }, MPESA_POLL_TRIES);
      } else {
        if (!result.redirect_url) throw new Error('Card payment could not be started.');
        window.open(result.redirect_url, '_blank', 'noopener');
        setPhase('waiting');
        setStatusText('Complete the card payment in the Paystack tab. We’ll confirm here.');
        await pollStatus({ paystack_reference: result.transaction_id }, CARD_POLL_TRIES);
      }
    } catch (e) {
      if (cancelled.current) return;
      setPhase('failed');
      setError(e.message || 'Payment failed. Please try again.');
    }
  };

  return (
    <div className="page">
      {busy && (
        <div className="pay-overlay" role="status" aria-live="polite">
          <div className="pay-overlay-card">
            <video
              className="pay-anim"
              src={payingVideo}
              autoPlay
              loop
              muted
              playsInline
            />
            <b className="pay-overlay-title">
              {phase === 'working' ? 'Setting up your payment' : 'Waiting for confirmation'}
            </b>
            <p className="pay-overlay-text">{statusText}</p>
            <div className="pay-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          </div>
        </div>
      )}

      <div className="container">
        <BackButton />
        <BookingSteps current={2} />

        <div className="booking-layout">
          <div className="form-card">
            <div className="field">
              <label>Pay with</label>
              <button
                className={`pay-method${method === 'mpesa' ? ' selected' : ''}`}
                onClick={() => !busy && setMethod('mpesa')}
              >
                <span className="icon">
                  <PhoneIcon size={21} />
                </span>
                <span>
                  M-Pesa
                  <span className="sub">You&apos;ll get an STK push on your phone</span>
                </span>
                <span className="card-logos">
                  <img src={mpesaImg} alt="M-Pesa" className="mpesa-img" />
                </span>
              </button>
              <button
                className={`pay-method${method === 'card' ? ' selected' : ''}`}
                onClick={() => !busy && setMethod('card')}
              >
                <span className="icon">
                  <CreditCardIcon size={21} />
                </span>
                <span>
                  Card
                  <span className="sub">Secure Paystack checkout</span>
                </span>
                <span className="card-logos">
                  <span className="visa-logo">VISA</span>
                  <MastercardMark />
                </span>
              </button>
              <Link to="/payments" target="_blank" className="link manage-methods">
                Add or manage payment methods
              </Link>
            </div>

            {method === 'mpesa' ? (
              <div className="field">
                <label>M-Pesa phone number</label>
                <div className="control">
                  <input
                    type="tel"
                    placeholder="+254 7XX XXX XXX"
                    value={phone}
                    disabled={busy}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>
              </div>
            ) : (
              <div className="notice" style={{ marginTop: 0 }}>
                You&apos;ll be redirected to <b>Paystack&apos;s secure page</b> to enter your card
                details. We never see or store your card number.
              </div>
            )}

            {phase === 'waiting' && (
              <div className="notice" style={{ marginTop: 0 }}>
                <b>{statusText}</b> Waiting for confirmation…
              </div>
            )}
            {phase === 'working' && (
              <div className="notice" style={{ marginTop: 0 }}>
                {statusText}
              </div>
            )}
            {error && (
              <div
                className="field"
                style={{ color: 'var(--error)', fontSize: 'var(--fs-sm)', fontWeight: 700 }}
              >
                {error}
              </div>
            )}

            <button
              className="btn-primary btn-block cta-desktop-only"
              style={{ marginTop: 10 }}
              disabled={!payValid || busy}
              onClick={payNow}
            >
              {payLabel}
            </button>

            <div className="notice">
              Payments are held by <b>Ardena</b> and released to the host after pickup. Your
              booking is confirmed the moment the payment goes through.
            </div>
          </div>

          <aside className="side-sticky">
            <div className="form-card">
              <div className="mini-car">
                <CarPhoto car={car} className="pic" />
                <div>
                  <b>{car.name}</b>
                  <div className="car-meta">
                    {state.driveType === 'self' ? 'Self drive' : 'With chauffeur'}
                  </div>
                </div>
              </div>
              <div className="breakdown">
                <div className="row">
                  <span>Pickup</span>
                  <span>
                    {formatDateLong(state.pickupDate)} · {state.pickupTime}
                  </span>
                </div>
                <div className="row">
                  <span>Drop-off</span>
                  <span>
                    {formatDateLong(state.dropoffDate)} · {state.dropoffTime}
                  </span>
                </div>
                <div className="row">
                  <span>Location</span>
                  <span>{state.pickupLocation}</span>
                </div>
                <div className="row">
                  <span>
                    Rental ({state.days} day{state.days === 1 ? '' : 's'})
                  </span>
                  <span>{formatKES(state.subtotal)}</span>
                </div>
                {state.damageWaiver && (
                  <div className="row">
                    <span>Damage waiver</span>
                    <span>{formatKES(state.waiver)}</span>
                  </div>
                )}
                {state.deposit > 0 && (
                  <div className="row">
                    <span>Refundable deposit</span>
                    <span>{formatKES(state.deposit)}</span>
                  </div>
                )}
                <div className="row total">
                  <span>Total due now</span>
                  <span key={totalDue} className="total-pop">
                    {formatKES(totalDue)}
                  </span>
                </div>
                {state.deposit > 0 && (
                  <p className="breakdown-note">
                    Includes a {formatKES(state.deposit)} deposit, refunded to you after the trip.
                  </p>
                )}
              </div>
            </div>
          </aside>
        </div>
      </div>

      <StickyActionBar
        info={
          <>
            <span className="sab-label">Total due now</span>
            <b>{formatKES(totalDue)}</b>
          </>
        }
      >
        <button className="btn-primary" disabled={!payValid || busy} onClick={payNow}>
          {payLabel}
        </button>
      </StickyActionBar>
    </div>
  );
}
