import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  NAKURU_LOCATIONS,
  DAMAGE_WAIVER_PRICE_PER_DAY,
  formatKES,
  daysBetween,
  addDays,
} from '../data.js';
import { useCar, unavailableDateSet, deliveryFeeLabel } from '../cars.js';
import { getPendingDriverHire, clearPendingDriverHire } from '../driverHandoff.js';
import { getCarAvailability } from '../api.js';
import { CarPhoto, Toggle, BackButton, BookingSteps, StickyActionBar } from '../components.jsx';
import { DateRangeCalendar, fmtShort } from '../Calendar.jsx';
import {
  CalendarIcon,
  MapPinIcon,
  SteeringIcon,
  UsersIcon,
  PhoneIcon,
  CarIcon,
  CreditCardIcon,
  ClockIcon,
  XIcon,
} from '../icons.jsx';

const TIMES = ['07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '14:00', '16:00', '18:00'];

// Only the damage waiver is charged today (flat KES 250/day server-side);
// premium tiers land later, so the card is visible but not selectable yet.
const PROTECTION_OPTIONS = [
  {
    id: 'basic',
    name: 'Basic protection',
    price: 'Included',
    desc: 'Comprehensive insurance with every trip. You stay responsible for accidental damage up to the excess.',
  },
  {
    id: 'waiver',
    name: 'Damage waiver',
    price: `${formatKES(DAMAGE_WAIVER_PRICE_PER_DAY)}/day`,
    desc: 'Reduces your responsibility for accidental damage. Theft protection included.',
    tag: 'Popular',
  },
  {
    id: 'premium',
    name: 'Premium protection',
    price: 'Coming soon',
    desc: 'Lowest damage responsibility and priority roadside assistance.',
    disabled: true,
  },
];

export default function Booking() {
  const { id } = useParams();
  const { car, loading, error } = useCar(id);

  if (loading) {
    return (
      <div className="page">
        <div className="container">
          <div className="booking-layout" aria-hidden="true">
            <div className="form-card">
              {Array.from({ length: 4 }, (_, i) => (
                <div className="field" key={i}>
                  <div className="skel-line" style={{ width: '32%', height: 12, marginTop: 0 }} />
                  <div className="skel-line" style={{ width: '100%', height: 46, borderRadius: 0 }} />
                </div>
              ))}
            </div>
            <aside className="side-sticky">
              <div className="form-card">
                <div className="skel-line" style={{ width: '55%', height: 20, marginTop: 0 }} />
                <div className="skel-line" style={{ width: '100%', height: 130, borderRadius: 0 }} />
                <div
                  className="skel-line"
                  style={{ width: '100%', height: 46, borderRadius: 0, marginTop: 20 }}
                />
              </div>
            </aside>
          </div>
        </div>
      </div>
    );
  }

  if (error || !car) {
    return (
      <div className="page container">
        <div className="empty">
          {error ? `Couldn't load this car — ${error}.` : 'Car not found.'}{' '}
          <Link to="/">Back to browsing</Link>
        </div>
      </div>
    );
  }

  return <BookingForm car={car} />;
}

function BookingForm({ car }) {
  const navigate = useNavigate();
  const minDays = car.minRentalDays;

  const [pickupDate, setPickupDate] = useState(addDays(new Date(), 1));
  const [dropoffDate, setDropoffDate] = useState(addDays(new Date(), 1 + minDays));
  const [calOpen, setCalOpen] = useState(false);
  const calRef = useRef(null);
  const [pickupTime, setPickupTime] = useState('10:00');
  const [dropoffTime, setDropoffTime] = useState('10:00');
  const [sameDropoff, setSameDropoff] = useState(true);
  const [dropoffLocation, setDropoffLocation] = useState('');
  const [driveType, setDriveType] = useState(car.driveTypes.length === 1 ? car.driveTypes[0] : null);
  // Sensible defaults, still switchable: basic protection + self check-in.
  const [protection, setProtection] = useState('basic');
  const [checkIn, setCheckIn] = useState('self');
  const damageWaiver = protection === 'waiver';
  const [notes, setNotes] = useState('');
  const [unavailable, setUnavailable] = useState(() => new Set());
  // Pickup at the host's spot, or delivered to the renter (and collected from there).
  const [handoff, setHandoff] = useState('pickup');
  const [deliveryCity, setDeliveryCity] = useState(
    car.deliveryCities.length === 1 ? car.deliveryCities[0].city : ''
  );
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [pin, setPin] = useState(null); // { latitude, longitude } from "Use my current location"
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState('');
  const [paymentMode, setPaymentMode] = useState('full');
  // A driver hired first (Ardena Chauffeurs) who will drive this car.
  const [driverHire, setDriverHire] = useState(getPendingDriverHire);
  const delivering = handoff === 'delivery';
  const deliveryChoice = car.deliveryCities.find((d) => d.city === deliveryCity) || null;

  useEffect(() => {
    const onClick = (e) => {
      if (calRef.current && !calRef.current.contains(e.target)) setCalOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  // Grey out already-booked / blocked days for the next four months.
  useEffect(() => {
    let on = true;
    getCarAvailability(car.id, addDays(new Date(), 0), addDays(new Date(), 120))
      .then((availability) => {
        if (on) setUnavailable(unavailableDateSet(availability));
      })
      .catch(() => {
        /* calendar simply shows all days as selectable */
      });
    return () => {
      on = false;
    };
  }, [car.id]);

  const days = dropoffDate ? daysBetween(pickupDate, dropoffDate) : 0;

  const rangeBlocked = useMemo(() => {
    if (!dropoffDate) return false;
    for (let d = pickupDate; d < dropoffDate; d = addDays(d, 1)) {
      if (unavailable.has(d)) return true;
    }
    return false;
  }, [pickupDate, dropoffDate, unavailable]);

  // An estimate to choose with; the payment page shows the server's own figures.
  const pricing = useMemo(() => {
    const subtotal = days * car.pricePerDay;
    const waiver = damageWaiver ? days * DAMAGE_WAIVER_PRICE_PER_DAY : 0;
    const deposit = car.deposit || 0;
    const deliveryFee = delivering && deliveryChoice ? deliveryChoice.fee : 0;
    return { subtotal, waiver, deposit, deliveryFee, total: subtotal + waiver + deposit + deliveryFee };
  }, [car, days, damageWaiver, delivering, deliveryChoice]);

  const tooShort = Boolean(dropoffDate) && days < minDays;
  const dropoffPoint = sameDropoff ? car.locationName : dropoffLocation;
  const splitPay = paymentMode === 'pay_on_pickup';
  const totalLabel = splitPay ? 'Trip total' : 'Total due now';

  // Asked only on tap; the server turns the coordinates into an address.
  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setLocateError('Your browser can’t share your location. Type the address instead.');
      return;
    }
    setLocating(true);
    setLocateError('');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPin({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        setLocating(false);
      },
      (err) => {
        setLocating(false);
        setLocateError(
          err.code === 1
            ? 'Location is blocked for this site. Allow it, or type the address.'
            : 'Couldn’t get your location. Type the address instead.'
        );
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  };

  // Everything blocking "Continue to payment", so the button can say why.
  const missing = [];
  if (!dropoffDate) missing.push('trip dates');
  else if (tooShort) missing.push(`at least ${minDays} day${minDays > 1 ? 's' : ''}`);
  if (rangeBlocked) missing.push('available dates');
  if (delivering) {
    if (!deliveryChoice) missing.push('a delivery city');
    if (!deliveryAddress.trim() && !pin) missing.push('a delivery address');
  } else if (!dropoffPoint) missing.push('a drop-off point');
  if (!driveType) missing.push('drive type');
  if (!protection) missing.push('protection');
  if (!checkIn) missing.push('check-in');
  const canContinue = missing.length === 0;

  const continueToPayment = () => {
    navigate('/pay', {
      state: {
        car,
        pickupDate,
        pickupTime,
        dropoffDate,
        dropoffTime,
        pickupLocation: car.locationName,
        dropoffLocation: dropoffPoint,
        delivery: delivering
          ? {
              city: deliveryChoice.city,
              address: deliveryAddress.trim() || null,
              ...(pin || {}),
              source: pin ? 'current_location' : 'typed',
            }
          : null,
        paymentMode,
        chauffeurBookingId: driverHire?.id || null,
        driverName: driverHire?.name || null,
        driveType,
        damageWaiver,
        checkIn,
        notes,
        days,
        ...pricing,
      },
    });
  };

  return (
    <div className="page">
      <div className="container">
        <BackButton to={`/cars/${car.id}`} />
        <BookingSteps current={1} />

        <div className="booking-layout">
          <div className="form-card">
            <div className="field" style={{ position: 'relative' }} ref={calRef}>
              <label>Trip dates</label>
              <button
                type="button"
                className="control"
                style={{ width: '100%', textAlign: 'left' }}
                onClick={() => setCalOpen((v) => !v)}
              >
                <CalendarIcon size={17} style={{ color: 'var(--hint)' }} />{' '}
                <span style={{ fontWeight: 700 }}>
                  {fmtShort(pickupDate)} → {dropoffDate ? fmtShort(dropoffDate) : 'add drop-off'}
                </span>
              </button>
              {calOpen && (
                <div className="cal-pop" style={{ top: 'calc(100% + 10px)', left: 0 }}>
                  <DateRangeCalendar
                    start={pickupDate}
                    end={dropoffDate}
                    minDate={addDays(new Date(), 1)}
                    disabledDates={unavailable}
                    onChange={(s, e) => {
                      setPickupDate(s);
                      setDropoffDate(e);
                      if (s && e) setCalOpen(false);
                    }}
                  />
                </div>
              )}
            </div>

            <div className="two-col">
              <div className="field">
                <label>Pickup time</label>
                <div className="control">
                  <select value={pickupTime} onChange={(e) => setPickupTime(e.target.value)}>
                    {TIMES.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="field">
                <label>Drop-off time</label>
                <div className="control">
                  <select value={dropoffTime} onChange={(e) => setDropoffTime(e.target.value)}>
                    {TIMES.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {tooShort && (
              <div className="notice" style={{ marginTop: 0, marginBottom: 18 }}>
                <b>
                  Minimum rental for this car is {minDays} day{minDays > 1 ? 's' : ''}.
                </b>{' '}
                Please pick a later drop-off date.
              </div>
            )}

            {rangeBlocked && (
              <div className="notice" style={{ marginTop: 0, marginBottom: 18 }}>
                <b>Some of those dates are already booked.</b> Please choose dates around the
                greyed-out days.
              </div>
            )}

            {car.deliveryAvailable && (
              <div className="field">
                <label>
                  Getting the car <span className="choose-hint">choose one</span>
                </label>
                <div className="seg">
                  <button
                    type="button"
                    className={`choice-btn${!delivering ? ' selected' : ''}`}
                    onClick={() => setHandoff('pickup')}
                  >
                    <span className="radio-dot" />
                    <MapPinIcon size={16} /> Pickup
                  </button>
                  <button
                    type="button"
                    className={`choice-btn${delivering ? ' selected' : ''}`}
                    onClick={() => setHandoff('delivery')}
                  >
                    <span className="radio-dot" />
                    <CarIcon size={16} /> Delivery
                  </button>
                </div>
              </div>
            )}

            {delivering ? (
              <>
                <div className="field">
                  <label>Delivery city</label>
                  <div className="control">
                    <select value={deliveryCity} onChange={(e) => setDeliveryCity(e.target.value)}>
                      <option value="">Choose a city…</option>
                      {car.deliveryCities.map((d) => (
                        <option key={d.city} value={d.city}>
                          {d.city} · {deliveryFeeLabel(d)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="field">
                  <label>Delivery address</label>
                  <div className="control">
                    <MapPinIcon size={17} style={{ color: 'var(--hint)' }} />
                    <input
                      placeholder={pin ? 'Add a note, e.g. Gate B, blue building' : 'Street, building or landmark'}
                      value={deliveryAddress}
                      maxLength={500}
                      onChange={(e) => setDeliveryAddress(e.target.value)}
                    />
                  </div>
                  <div className="locate-row">
                    {pin ? (
                      <span className="locate-done">
                        <MapPinIcon size={14} /> Using your current location
                        <button
                          type="button"
                          className="link"
                          onClick={() => setPin(null)}
                          aria-label="Stop using my location"
                        >
                          <XIcon size={13} />
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="link"
                        onClick={useMyLocation}
                        disabled={locating}
                      >
                        {locating ? 'Finding you…' : 'Use my current location'}
                      </button>
                    )}
                  </div>
                  {locateError && <span className="field-error">{locateError}</span>}
                </div>
                <div className="notice" style={{ marginTop: 0, marginBottom: 18 }}>
                  Delivered to you and collected from the same address at the end of the trip.
                </div>
              </>
            ) : (
              <>
                <div className="field">
                  <label>Pickup location (set by host)</label>
                  <div className="control readonly">
                    <MapPinIcon size={17} style={{ color: 'var(--hint)' }} /> {car.locationName},{' '}
                    {car.city}
                  </div>
                </div>

                <div className="field">
                  <div className="toggle-row" style={{ marginBottom: 14 }}>
                    <div className="t-label">
                      <b>Return to the same location</b>
                      <span>Drop the car where you picked it up</span>
                    </div>
                    <Toggle on={sameDropoff} onChange={setSameDropoff} />
                  </div>
                  {!sameDropoff && (
                    <div className="control">
                      <select
                        value={dropoffLocation}
                        onChange={(e) => setDropoffLocation(e.target.value)}
                      >
                        <option value="">Choose a drop-off point…</option>
                        {NAKURU_LOCATIONS.map((l) => (
                          <option key={l.id} value={l.name}>
                            {l.name} — {l.address}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              </>
            )}

            {car.payOnPickupAvailable && (
              <div className="field">
                <label>
                  How you pay <span className="choose-hint">choose one</span>
                </label>
                <div className="seg">
                  <button
                    type="button"
                    className={`choice-btn${!splitPay ? ' selected' : ''}`}
                    onClick={() => setPaymentMode('full')}
                  >
                    <span className="radio-dot" />
                    <CreditCardIcon size={16} /> Pay now
                  </button>
                  <button
                    type="button"
                    className={`choice-btn${splitPay ? ' selected' : ''}`}
                    onClick={() => setPaymentMode('pay_on_pickup')}
                  >
                    <span className="radio-dot" />
                    <ClockIcon size={16} /> Pay on pickup
                  </button>
                </div>
                {splitPay && (
                  <p className="field-hint">
                    Pay Ardena’s fee{car.deposit ? ' and the deposit' : ''}
                    {delivering ? ' and the delivery fee' : ''} now, and the rest when you get the
                    car. You’ll see both amounts on the next step.
                  </p>
                )}
              </div>
            )}

            {driverHire && (
              <div className="notice driver-hire-note" style={{ marginTop: 0, marginBottom: 18 }}>
                <UsersIcon size={16} />
                <span>
                  <b>{driverHire.name || 'Your Ardena driver'}</b> will drive this car, so you
                  don’t need a driving licence for this booking.
                </span>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Book without this driver"
                  onClick={() => {
                    clearPendingDriverHire();
                    setDriverHire(null);
                  }}
                >
                  <XIcon size={14} />
                </button>
              </div>
            )}

            <div className="field">
              <label>
                Drive type <span className="choose-hint">choose one</span>
              </label>
              <div className="seg">
                {car.driveTypes.map((t) => (
                  <button
                    key={t}
                    className={`choice-btn${driveType === t ? ' selected' : ''}`}
                    onClick={() => setDriveType(t)}
                  >
                    <span className="radio-dot" />
                    {t === 'self' ? (
                      <>
                        <SteeringIcon size={16} /> Self drive
                      </>
                    ) : (
                      <>
                        <UsersIcon size={16} /> With chauffeur
                      </>
                    )}
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <label>
                Check-in <span className="choose-hint">choose one</span>
              </label>
              <div className="seg">
                <button
                  className={`choice-btn${checkIn === 'self' ? ' selected' : ''}`}
                  onClick={() => setCheckIn('self')}
                >
                  <span className="radio-dot" />
                  <PhoneIcon size={16} /> Self check-in
                </button>
                <button
                  className={`choice-btn${checkIn === 'assisted' ? ' selected' : ''}`}
                  onClick={() => setCheckIn('assisted')}
                >
                  <span className="radio-dot" />
                  <UsersIcon size={16} /> Assisted by host
                </button>
              </div>
            </div>

            <div className="field">
              <label>
                Protection <span className="choose-hint">choose one</span>
              </label>
              <div className="protect-list">
                {PROTECTION_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={opt.disabled}
                    className={`protect-card${protection === opt.id ? ' selected' : ''}${
                      opt.disabled ? ' disabled' : ''
                    }`}
                    onClick={() => !opt.disabled && setProtection(opt.id)}
                  >
                    <span className="radio-dot" />
                    <span className="protect-main">
                      <span className="protect-name">
                        {opt.name}
                        {opt.tag && <em className="protect-tag">{opt.tag}</em>}
                      </span>
                      <span className="protect-desc">{opt.desc}</span>
                    </span>
                    <b className="protect-price">{opt.price}</b>
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <label>Special requirements (optional)</label>
              <div className="control">
                <textarea
                  placeholder="Child seat, airport pickup, extra driver…"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
            </div>

            <div className="notice">
              Minimum driver age for this car is <b>{car.minAge} years</b>. Your profile and
              driver&apos;s licence will be verified before pickup, same as in the app.
            </div>
          </div>

          <aside className="side-sticky">
            <div className="form-card">
              <div className="mini-car">
                <CarPhoto car={car} className="pic" />
                <div>
                  <b>{car.name}</b>
                  <div className="car-meta">
                    {car.rating ? `★ ${car.rating.toFixed(1)} · ` : ''}
                    {car.locationName}
                  </div>
                </div>
              </div>

              <div className="breakdown">
                <div className="row">
                  <span>
                    {formatKES(car.pricePerDay)} × {days} day{days === 1 ? '' : 's'}
                  </span>
                  <span>{formatKES(pricing.subtotal)}</span>
                </div>
                {damageWaiver && (
                  <div className="row">
                    <span>Damage waiver</span>
                    <span>{formatKES(pricing.waiver)}</span>
                  </div>
                )}
                {pricing.deposit > 0 && (
                  <div className="row">
                    <span>Refundable deposit</span>
                    <span>{formatKES(pricing.deposit)}</span>
                  </div>
                )}
                {delivering && deliveryChoice && (
                  <div className="row">
                    <span>Delivery &amp; collection</span>
                    <span>{deliveryFeeLabel(deliveryChoice)}</span>
                  </div>
                )}
                <div className="row total">
                  <span>{totalLabel}</span>
                  <span key={pricing.total} className="total-pop">
                    {formatKES(pricing.total)}
                  </span>
                </div>
                {pricing.deposit > 0 && (
                  <p className="breakdown-note">
                    Includes a {formatKES(pricing.deposit)} deposit, refunded to you after the trip.
                  </p>
                )}
                {splitPay && (
                  <p className="breakdown-note">
                    Pay on pickup: part now, the rest when you get the car. Exact amounts on the
                    next step.
                  </p>
                )}
              </div>

              <button
                className="btn-primary btn-block cta-desktop-only"
                style={{ marginTop: 22 }}
                disabled={!canContinue}
                onClick={continueToPayment}
              >
                Continue to payment
              </button>
              {!canContinue && (
                <p className="missing-hint">
                  Still needed: <b>{missing.join(' · ')}</b>
                </p>
              )}
            </div>
          </aside>
        </div>
      </div>

      <StickyActionBar
        info={
          <>
            <span className="sab-label">{totalLabel}</span>
            <b>{formatKES(pricing.total)}</b>
          </>
        }
      >
        <button className="btn-primary" disabled={!canContinue} onClick={continueToPayment}>
          Continue to payment
        </button>
      </StickyActionBar>
    </div>
  );
}
