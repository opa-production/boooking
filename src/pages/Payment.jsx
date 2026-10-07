import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { formatKES, formatDateLong } from '../data.js';
import { CarPhoto, BackButton, MastercardMark, BookingSteps, StickyActionBar } from '../components.jsx';
import mpesaImg from '../assets/mpesa.png';
import payingVideo from '../assets/payment.webm';
import { useApp } from '../store.jsx';
import { useScrollLock } from '../useScrollLock.js';
import * as api from '../api.js';
import {
  ensureMpesaMethod,
  pollPayment,
  openPaystack,
  onPaymentReturn,
  MPESA_POLL_TRIES,
  CARD_POLL_TRIES,
} from '../payments.js';
import { clearPendingDriverHire } from '../driverHandoff.js';
import { PhoneIcon, CreditCardIcon } from '../icons.jsx';

/** The POST /client/bookings body for the trip chosen on the previous step. */
function bookingPayload(state) {
  const payload = {
    car_id: Number(state.car.id),
    start_date: `${state.pickupDate}T${state.pickupTime || '10:00'}:00`,
    end_date: `${state.dropoffDate}T${state.dropoffTime || '10:00'}:00`,
    pickup_time: state.pickupTime,
    return_time: state.dropoffTime,
    damage_waiver_enabled: state.damageWaiver,
    drive_type: state.driveType,
    check_in_preference: state.checkIn,
    special_requirements: state.notes || null,
    payment_mode: state.paymentMode || 'full',
  };
  if (state.delivery) {
    // The host delivers to and collects from this address: no pickup/return points.
    payload.delivery = state.delivery;
  } else {
    payload.pickup_location = state.pickupLocation;
    payload.return_location = state.dropoffLocation;
    payload.dropoff_same_as_pickup = state.pickupLocation === state.dropoffLocation;
  }
  if (state.chauffeurBookingId) payload.chauffeur_booking_id = state.chauffeurBookingId;
  return payload;
}

export default function Payment() {
  const { state, key } = useLocation();
  const navigate = useNavigate();
  const { user } = useApp();

  const [method, setMethod] = useState('mpesa');
  const [phone, setPhone] = useState(user?.phone || '');
  // idle | working | waiting (user completing payment) | failed
  const [phase, setPhase] = useState('idle');
  const [statusText, setStatusText] = useState('');
  const [error, setError] = useState('');
  // The booking is created when this page opens, so every amount shown is the
  // server's. It's kept in the history entry: a reload or Back/Forward reuses it.
  const [booking, setBooking] = useState(state?.booking || null);
  const [createError, setCreateError] = useState('');
  const creating = useRef(null);
  const cancelled = useRef(false);
  const wake = useRef(null);

  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);

  // The Paystack tab came back: check the status now instead of at the next tick.
  useEffect(() => onPaymentReturn(() => wake.current && wake.current()), []);

  const createBooking = () => {
    if (creating.current) return creating.current;
    setCreateError('');
    creating.current = api
      .createBooking(bookingPayload(state))
      .then((created) => {
        if (state.chauffeurBookingId) clearPendingDriverHire();
        setBooking(created);
        navigate('.', { replace: true, state: { ...state, booking: created } });
        return created;
      })
      .catch((e) => {
        setCreateError(e.message || 'Couldn’t create your booking. Please try again.');
        throw e;
      })
      .finally(() => {
        creating.current = null;
      });
    return creating.current;
  };

  useEffect(() => {
    if (state?.car && !booking) createBooking().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

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
  const ready = Boolean(booking);
  const payValid = ready && (method === 'mpesa' ? phone.replace(/\D/g, '').length >= 9 : true);
  // What this payment charges: the total, or only the upfront part on pay on pickup.
  const totalDue = booking ? booking.amount_due_now ?? booking.total_price : null;
  const split = booking?.payment_mode === 'pay_on_pickup' ? booking.pay_on_pickup : null;
  const delivery = booking?.delivery || null;
  const amountText = totalDue != null ? formatKES(totalDue) : '…';

  // Shared by the in-card button and the mobile sticky bar so they never drift.
  const payLabel = !ready
    ? createError
      ? 'Booking not created'
      : 'Preparing your booking…'
    : phase === 'working'
      ? 'Starting payment…'
      : phase === 'waiting'
        ? 'Waiting for payment…'
        : phase === 'failed'
          ? `Try again — pay ${amountText}`
          : `Pay ${amountText}`;

  const finish = (status) => {
    if (!status) return; // left the page
    if (status.status === 'completed') {
      navigate(`/confirmed/${status.booking_id}`, { replace: true });
      return;
    }
    setPhase('failed');
    setError(
      status.status === 'timeout'
        ? 'We haven’t received the payment confirmation yet. You can try again.'
        : status.message || `Payment ${status.status}. You can try again.`
    );
  };

  const payNow = async () => {
    if (busy || !booking) return;
    setError('');
    setPhase('working');
    setStatusText('Contacting the payment provider…');
    try {
      const methodId = method === 'mpesa' ? await ensureMpesaMethod(phone) : null;
      let result;
      try {
        result = await api.processPayment(booking.booking_id, methodId);
      } catch (e) {
        // An abandoned checkout is cancelled after a while: start a fresh booking.
        if ([400, 404, 409].includes(e.status) && /cancel|expired|not found|status/i.test(e.message)) {
          setBooking(null);
          navigate('.', { replace: true, state: { ...state, booking: null } });
        }
        throw e;
      }

      if (method === 'mpesa') {
        setPhase('waiting');
        setStatusText('STK push sent. Enter your M-Pesa PIN on your phone to pay.');
        finish(
          await pollPayment(
            { checkout_request_id: result.transaction_id },
            { tries: MPESA_POLL_TRIES, isCancelled: () => cancelled.current, wake }
          )
        );
      } else {
        if (!result.redirect_url) throw new Error('Card payment could not be started.');
        if (!openPaystack(result.redirect_url)) return; // this tab is going to Paystack
        setPhase('waiting');
        setStatusText('Complete the card payment in the Paystack tab. We’ll confirm here.');
        finish(
          await pollPayment(
            { paystack_reference: result.transaction_id },
            { tries: CARD_POLL_TRIES, isCancelled: () => cancelled.current, wake }
          )
        );
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
            <video className="pay-anim" src={payingVideo} autoPlay loop muted playsInline />
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
            {createError && (
              <div className="notice error-notice" style={{ marginTop: 0, marginBottom: 18 }}>
                <b>{createError}</b>
                <div className="notice-actions">
                  <button className="btn-secondary btn-sm" onClick={() => navigate(-1)}>
                    Change trip details
                  </button>
                  <button
                    className="btn-secondary btn-sm"
                    onClick={() => createBooking().catch(() => {})}
                  >
                    Try again
                  </button>
                </div>
              </div>
            )}

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
              {split ? (
                <>
                  You pay <b>{formatKES(split.upfront_amount)}</b> now to confirm the booking, and{' '}
                  <b>{formatKES(split.balance_amount)}</b> when you get the car. Your pickup code
                  appears once the balance is paid.
                </>
              ) : (
                <>
                  Payments are held by <b>Ardena</b> and released to the host after pickup. Your
                  booking is confirmed the moment the payment goes through.
                </>
              )}
            </div>
          </div>

          <aside className="side-sticky">
            <div className="form-card">
              <div className="mini-car">
                <CarPhoto car={car} className="pic" />
                <div>
                  <b>{car.name}</b>
                  <div className="car-meta">
                    {state.driverName
                      ? `Driven by ${state.driverName}`
                      : state.driveType === 'self'
                        ? 'Self drive'
                        : 'With chauffeur'}
                  </div>
                </div>
              </div>
              <div className="breakdown">
                <div className="row">
                  <span>{delivery || state.delivery ? 'Delivery' : 'Pickup'}</span>
                  <span>
                    {formatDateLong(state.pickupDate)} · {state.pickupTime}
                  </span>
                </div>
                <div className="row">
                  <span>{delivery || state.delivery ? 'Collection' : 'Drop-off'}</span>
                  <span>
                    {formatDateLong(state.dropoffDate)} · {state.dropoffTime}
                  </span>
                </div>
                <div className="row">
                  <span>{delivery || state.delivery ? 'Address' : 'Location'}</span>
                  <span>
                    {delivery
                      ? delivery.address
                      : state.delivery
                        ? state.delivery.address || `Your location, ${state.delivery.city}`
                        : state.pickupLocation}
                  </span>
                </div>

                {!booking ? (
                  <>
                    <div className="skel-line" style={{ width: '100%', height: 16 }} />
                    <div className="skel-line" style={{ width: '70%', height: 16 }} />
                  </>
                ) : (
                  <>
                    <div className="row">
                      <span>
                        Rental ({booking.rental_days} day{booking.rental_days === 1 ? '' : 's'})
                      </span>
                      <span>{formatKES(booking.base_price)}</span>
                    </div>
                    {booking.damage_waiver_fee > 0 && (
                      <div className="row">
                        <span>Damage waiver</span>
                        <span>{formatKES(booking.damage_waiver_fee)}</span>
                      </div>
                    )}
                    {booking.deposit_amount > 0 && (
                      <div className="row">
                        <span>Refundable deposit</span>
                        <span>{formatKES(booking.deposit_amount)}</span>
                      </div>
                    )}
                    {delivery && (
                      <div className="row">
                        <span>Delivery &amp; collection</span>
                        <span>{booking.delivery_fee > 0 ? formatKES(booking.delivery_fee) : 'Free'}</span>
                      </div>
                    )}
                    {split ? (
                      <>
                        <div className="row">
                          <span>Trip total</span>
                          <span>{formatKES(booking.total_price)}</span>
                        </div>
                        <div className="row total">
                          <span>Pay now</span>
                          <span key={totalDue} className="total-pop">
                            {formatKES(split.upfront_amount)}
                          </span>
                        </div>
                        <div className="row">
                          <span>Pay at pickup</span>
                          <span>{formatKES(split.balance_amount)}</span>
                        </div>
                      </>
                    ) : (
                      <div className="row total">
                        <span>Total due now</span>
                        <span key={totalDue} className="total-pop">
                          {formatKES(totalDue)}
                        </span>
                      </div>
                    )}
                    {booking.deposit_amount > 0 && (
                      <p className="breakdown-note">
                        Includes a {formatKES(booking.deposit_amount)} deposit, refunded to you
                        after the trip.
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
          </aside>
        </div>
      </div>

      <StickyActionBar
        info={
          <>
            <span className="sab-label">{split ? 'Pay now' : 'Total due now'}</span>
            <b>{amountText}</b>
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
