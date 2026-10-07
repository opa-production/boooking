import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { formatKES, formatDateLong, addDays, DAMAGE_WAIVER_PRICE_PER_DAY } from '../data.js';
import {
  useCar,
  useCarRatings,
  ratingLabel,
  noteRecentlyViewed,
  hostingDuration,
  useHostAvatar,
  deliveryBadge,
  deliveryFeeLabel,
} from '../cars.js';
import { fmtShort } from '../Calendar.jsx';
import { CarPhoto, BackButton, StickyActionBar } from '../components.jsx';
import { useApp } from '../store.jsx';
import { useToast } from '../toast.jsx';
import { useScrollLock } from '../useScrollLock.js';
import { reportListing, listBookings, getCarAvailability } from '../api.js';
import {
  CogIcon,
  FuelIcon,
  UsersIcon,
  CalendarIcon,
  SteeringIcon,
  ShieldIcon,
  ChatIcon,
  FlagIcon,
  StarIcon,
  BanIcon,
  CheckIcon,
  MapPinIcon,
  CreditCardIcon,
  HeartIcon,
  ShareIcon,
  PhoneIcon,
  IdCardIcon,
  XIcon,
  CarIcon,
  ClockIcon,
} from '../icons.jsx';

// Approximate city centres — used to place the pickup map until per-car
// latitude/longitude are populated upstream (they're null today).
const CITY_COORDS = {
  Nairobi: [-1.286389, 36.817223],
  Nakuru: [-0.303099, 36.08],
  Mombasa: [-4.043477, 39.668206],
  Kisumu: [-0.091702, 34.767956],
  Eldoret: [0.514277, 35.269779],
};

const Chevron = ({ dir }) => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    {dir === 'left' ? <polyline points="15 6 9 12 15 18" /> : <polyline points="9 6 15 12 9 18" />}
  </svg>
);

/** Full-screen photo carousel. Arrow keys / on-screen arrows navigate; Esc or
 * a backdrop click closes. */
function Lightbox({ photos, index, setIndex, onClose }) {
  useScrollLock(true);
  const go = (step) => setIndex((i) => (i + step + photos.length) % photos.length);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos.length]);

  return (
    <div className="lightbox" onClick={onClose} role="dialog" aria-label="Photos">
      <button className="lightbox-close" onClick={onClose} aria-label="Close">
        <XIcon size={22} />
      </button>
      {photos.length > 1 && (
        <button
          className="lightbox-nav prev"
          aria-label="Previous photo"
          onClick={(e) => {
            e.stopPropagation();
            go(-1);
          }}
        >
          <Chevron dir="left" />
        </button>
      )}
      <img className="lightbox-img" src={photos[index]} alt="" onClick={(e) => e.stopPropagation()} />
      {photos.length > 1 && (
        <button
          className="lightbox-nav next"
          aria-label="Next photo"
          onClick={(e) => {
            e.stopPropagation();
            go(1);
          }}
        >
          <Chevron dir="right" />
        </button>
      )}
      <div className="lightbox-count">
        {index + 1} / {photos.length}
      </div>
    </div>
  );
}

/** Pickup location map. Prefers the car's real coordinates; falls back to the
 * city centre with a note. Uses the free OpenStreetMap embed (no API key) —
 * swap for Mapbox GL once a client-side token endpoint exists. */
function PickupMap({ car }) {
  const exact = Boolean(car.latitude && car.longitude);
  const coords = exact ? [car.latitude, car.longitude] : CITY_COORDS[car.city];
  if (!coords) return null;
  const [lat, lng] = coords;
  const d = exact ? 0.012 : 0.06;
  const bbox = `${lng - d},${lat - d},${lng + d},${lat + d}`;
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(
    bbox
  )}&layer=mapnik${exact ? `&marker=${lat},${lng}` : ''}`;
  const link = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=${exact ? 15 : 12}/${lat}/${lng}`;

  return (
    <div className="section detail-divide">
      <h2>Pickup location</h2>
      <div className="pickup-map">
        <iframe title="Pickup location map" src={src} loading="lazy" />
        {!exact && <span className="pickup-pin" aria-hidden="true" />}
      </div>
      <div className="pickup-meta">
        <span className="pickup-place">
          <MapPinIcon size={16} /> {car.locationName}
          {car.city ? `, ${car.city}` : ''}
        </span>
        <a href={link} target="_blank" rel="noopener noreferrer" className="link">
          Open in Maps
        </a>
      </div>
      {!exact && (
        <p className="info-note" style={{ paddingBottom: 0 }}>
          Showing the general {car.city} area — your host shares the exact pickup point once your
          booking is confirmed.
        </p>
      )}
    </div>
  );
}

// Same options as the app's ReportListingScreen.
const REPORT_REASONS = [
  "It's fraudulent",
  'Not a real car',
  'Incorrect or misleading details',
  'Inappropriate photos or content',
  'Car is unavailable or already rented',
  'Something else',
];

/** Report-a-listing flow: pick a reason, describe the issue, submit to moderation. */
function ReportListing({ carId }) {
  const { user } = useApp();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const [error, setError] = useState('');

  if (done) return <div className="notice">{done}</div>;

  if (!open) {
    return (
      <button
        className="report-link"
        onClick={() => {
          if (!user) navigate('/login', { state: { next: `/cars/${carId}` } });
          else setOpen(true);
        }}
      >
        <FlagIcon size={15} /> Report this listing
      </button>
    );
  }

  const submit = async () => {
    if (busy || !reason || !details.trim()) return;
    setBusy(true);
    setError('');
    try {
      await reportListing(carId, reason, details.trim());
      setDone('Thanks — your report was sent. Our team will review this listing.');
    } catch (e) {
      if (e.status === 429) setDone('You’ve already reported this listing — it’s with our team.');
      else setError(e.message || 'Couldn’t send the report. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="info-card report-card">
      <h3>Why are you reporting this listing?</h3>
      <div className="report-reasons">
        {REPORT_REASONS.map((r) => (
          <button
            key={r}
            type="button"
            className={`report-reason${reason === r ? ' selected' : ''}`}
            onClick={() => setReason(r)}
          >
            {r}
            <span className="radio-dot" />
          </button>
        ))}
      </div>
      <div className="field" style={{ marginTop: 'var(--sp-4)', marginBottom: 0 }}>
        <label>Tell us more</label>
        <div className="control">
          <textarea
            maxLength={200}
            placeholder="Describe the issue (max 200 characters)…"
            value={details}
            onChange={(e) => setDetails(e.target.value)}
          />
        </div>
      </div>
      {error && (
        <div style={{ color: 'var(--error)', fontSize: 'var(--fs-sm)', fontWeight: 700, marginTop: 10 }}>
          {error}
        </div>
      )}
      <div style={{ display: 'flex', gap: 'var(--sp-3)', marginTop: 'var(--sp-4)', paddingBottom: 14 }}>
        <button
          className="btn-primary"
          disabled={busy || !reason || !details.trim()}
          onClick={submit}
        >
          {busy ? 'Sending…' : 'Send report'}
        </button>
        <button className="btn-secondary" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Live availability from GET /cars/{id}/availability for the next 3 months. */
function AvailabilityCard({ carId }) {
  const [avail, setAvail] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let on = true;
    setLoading(true);
    getCarAvailability(carId, addDays(new Date(), 0), addDays(new Date(), 90))
      .then((data) => {
        if (on) setAvail(data);
      })
      .catch(() => {})
      .finally(() => {
        if (on) setLoading(false);
      });
    return () => {
      on = false;
    };
  }, [carId]);

  if (loading) {
    return (
      <div className="section detail-divide">
        <h2>Availability</h2>
        <div className="skel-line" style={{ width: '60%', height: 46, borderRadius: 14 }} />
      </div>
    );
  }

  if (!avail) return null;

  const ranges = (avail.unavailable_dates || []).slice(0, 4);

  return (
    <div className="section detail-divide">
      <h2>Availability</h2>
      <div className="detail-list">
        <div className="info-row">
          <span>
            <CalendarIcon size={17} /> Right now
          </span>
          {avail.available ? (
            <b style={{ color: 'var(--success)' }}>
              <CheckIcon size={15} /> Available
            </b>
          ) : (
            <b style={{ color: 'var(--warning)' }}>
              {avail.next_available_date
                ? `Next available ${formatDateLong(String(avail.next_available_date).slice(0, 10))}`
                : 'Currently booked'}
            </b>
          )}
        </div>
        {ranges.length === 0 ? (
          <div className="info-row">
            <span>
              <CheckIcon size={16} style={{ color: 'var(--success)' }} /> No upcoming bookings in
              the next 3 months. All dates are open.
            </span>
          </div>
        ) : (
          ranges.map((r, i) => (
            <div className="info-row" key={i}>
              <span>
                <BanIcon size={16} /> {fmtShort(String(r.start_date).slice(0, 10))} →{' '}
                {fmtShort(String(r.end_date).slice(0, 10))}
              </span>
              <b style={{ color: 'var(--hint)' }}>Unavailable</b>
            </div>
          ))
        )}
        <p className="info-note">
          Unavailable days are greyed out in the calendar when you book.
        </p>
      </div>
    </div>
  );
}

const DEFAULT_RULES = [
  'No smoking in the car',
  'Return with the same fuel level',
  'Late returns are billed at an hourly rate',
  'Only verified drivers on the agreement may drive',
];

export default function CarDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, wishlist, toggleWish } = useApp();
  const toast = useToast();
  const { car, loading, error } = useCar(id);
  const ratings = useCarRatings(id);
  // Messaging unlocks only after a paid booking for this car.
  const [hasBooked, setHasBooked] = useState(false);
  const [copied, setCopied] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const hostAvatar = useHostAvatar(car?.host.id, car?.host.avatarUrl);

  useEffect(() => {
    if (car) noteRecentlyViewed(car.id);
  }, [car?.id]);

  useEffect(() => {
    if (!user || !car) {
      setHasBooked(false);
      return undefined;
    }
    let on = true;
    listBookings()
      .then((data) => {
        if (!on) return;
        setHasBooked(
          (data.bookings || []).some(
            (b) =>
              String(b.car_id) === car.id &&
              ['confirmed', 'active', 'completed'].includes(b.status)
          )
        );
      })
      .catch(() => {});
    return () => {
      on = false;
    };
  }, [user?.id, car?.id]);

  if (loading) {
    return (
      <div className="page">
        <div className="container">
          <div className="gallery5" aria-hidden="true">
            {['g-main', '', '', '', ''].map((c, i) => (
              <div className={`g-cell ${c}`} key={i} style={{ position: 'relative' }}>
                <div className="img-skel" />
              </div>
            ))}
          </div>
          <div className="details-layout" style={{ marginTop: 30 }}>
            <div>
              <div className="skel-line" style={{ width: '46%', height: 28, marginTop: 0 }} />
              <div className="skel-line" style={{ width: '30%', height: 14 }} />
              <div className="spec-list" style={{ marginTop: 30 }}>
                {Array.from({ length: 6 }, (_, i) => (
                  <div
                    key={i}
                    className="skel-line"
                    style={{ height: 66, marginTop: 0, borderRadius: 0 }}
                  />
                ))}
              </div>
            </div>
            <aside>
              <div className="skel-line" style={{ height: 240, marginTop: 0, borderRadius: 0 }} />
            </aside>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page container">
        <div className="empty">
          Couldn&apos;t load this car — {error}. <Link to="/">Back to browsing</Link>
        </div>
      </div>
    );
  }

  if (!car) {
    return (
      <div className="page container">
        <div className="empty">
          Car not found. <Link to="/">Back to browsing</Link>
        </div>
      </div>
    );
  }

  const reviewCount = ratings.total;
  const hosting = hostingDuration(car.host.createdAt);
  const hostFirstName = car.host.name.split(' ')[0];
  const wished = wishlist.has(car.id);

  const like = () => {
    const adding = !wished;
    if (!toggleWish(car.id)) {
      navigate('/login', { state: { next: `/cars/${car.id}` } });
      return;
    }
    toast.success(adding ? 'Saved to your wishlist' : 'Removed from wishlist');
  };

  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: `${car.name} on Ardena`, url });
        return;
      }
      throw new Error('no web share');
    } catch {
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        toast.success('Link copied to clipboard');
      } catch {
        toast.error('Couldn’t copy the link');
      }
    }
  };
  // Hosts write rules as free text, one per line; fall back to platform rules.
  const rules = car.rules
    ? car.rules.split('\n').map((r) => r.trim()).filter(Boolean)
    : DEFAULT_RULES;

  const startBooking = () => {
    if (!user) navigate('/login', { state: { next: `/book/${car.id}` } });
    else navigate(`/book/${car.id}`);
  };

  const messageHost = () => {
    navigate('/messages', {
      state: { hostId: car.host.id, hostName: car.host.name, carName: car.name },
    });
  };

  const openLightbox = (i) => {
    if (car.photos.length) setLightbox(Math.min(i, car.photos.length - 1));
  };

  const specs = [
    { icon: <CogIcon size={20} />, label: 'Transmission', value: car.transmission },
    { icon: <FuelIcon size={20} />, label: 'Fuel', value: car.fuel },
    { icon: <UsersIcon size={20} />, label: 'Seats', value: `${car.seats} seats` },
    { icon: <CalendarIcon size={20} />, label: 'Year', value: String(car.year) },
    {
      icon: <SteeringIcon size={20} />,
      label: 'Drive options',
      value: car.driveTypes.map((t) => (t === 'self' ? 'Self drive' : 'Chauffeur')).join(' · '),
    },
    { icon: <MapPinIcon size={20} />, label: 'Pickup', value: `${car.locationName}, ${car.city}` },
  ];

  return (
    <div className="page">
      <div className="container">
        <BackButton to="/" />

        <div className="gallery5">
          <CarPhoto car={car} index={0} className="g-cell g-main" onClick={() => openLightbox(0)} />
          <CarPhoto car={car} index={1} className="g-cell" onClick={() => openLightbox(1)} />
          <CarPhoto car={car} index={2} className="g-cell" onClick={() => openLightbox(2)} />
          <CarPhoto car={car} index={3} className="g-cell" onClick={() => openLightbox(3)} />
          <CarPhoto car={car} index={4} className="g-cell" onClick={() => openLightbox(4)} />
          {car.photos.length > 0 && (
            <button className="gallery-all" onClick={() => openLightbox(0)}>
              View all {car.photos.length} photos
            </button>
          )}
        </div>

        {lightbox !== null && (
          <Lightbox
            photos={car.photos}
            index={lightbox}
            setIndex={setLightbox}
            onClose={() => setLightbox(null)}
          />
        )}

        <div className="details-layout" style={{ marginTop: 30 }}>
          <div>
            <div className="title-row">
              <h1 className="page-title" style={{ marginBottom: 2 }}>
                {car.name}
              </h1>
              <div className="title-actions">
                <button
                  className={`pill-action${wished ? ' liked' : ''}`}
                  onClick={like}
                  aria-label="Like this car"
                >
                  <HeartIcon filled={wished} size={16} /> {wished ? 'Liked' : 'Like'}
                </button>
                <button className="pill-action" onClick={share} aria-label="Share this car">
                  {copied ? (
                    <>
                      <CheckIcon size={16} /> Copied
                    </>
                  ) : (
                    <>
                      <ShareIcon size={16} /> Share
                    </>
                  )}
                </button>
              </div>
            </div>
            <div className="rating-line">
              <StarIcon size={15} /> {ratingLabel(car)} · {reviewCount} review
              {reviewCount === 1 ? '' : 's'} · {car.locationName}, {car.city}
            </div>
            {(car.deliveryAvailable || car.payOnPickupAvailable) && (
              <div className="detail-badges">
                {car.deliveryAvailable && (
                  <span className="car-badge inline">
                    <CarIcon size={14} /> {deliveryBadge(car)}
                  </span>
                )}
                {car.payOnPickupAvailable && (
                  <span className="car-badge inline">
                    <ClockIcon size={14} /> Pay on pickup
                  </span>
                )}
              </div>
            )}
            {car.description && (
              <p className="dashed-card car-desc">{car.description}</p>
            )}

            <div className="section">
              <h2>Specs</h2>
              <div className="spec-list">
                {specs.map((s) => (
                  <div className="spec-item" key={s.label}>
                    <span className="spec-icon">{s.icon}</span>
                    <div>
                      <span className="spec-label">{s.label}</span>
                      <b>{s.value}</b>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <AvailabilityCard carId={car.id} />

            <div className="section detail-divide host-duo">
              <div>
                <h2>Meet your host</h2>
                <div className="host-panel">
                  <span className="avatar" style={{ width: 68, height: 68, fontSize: 'var(--fs-2xl)' }}>
                    {hostAvatar ? (
                      <img src={hostAvatar} alt={car.host.name} />
                    ) : (
                      car.host.name[0]
                    )}
                  </span>
                  <b className="host-name">{car.host.name}</b>
                  {car.host.joined && (
                    <span className="car-meta">Host since {car.host.joined}</span>
                  )}
                  <div className="host-stats">
                    <div>
                      <b>
                        {ratingLabel(car)} <StarIcon size={12} />
                      </b>
                      <span>Rating</span>
                    </div>
                    <div>
                      <b>{reviewCount}</b>
                      <span>Reviews</span>
                    </div>
                    <div>
                      <b>{hosting || '—'}</b>
                      <span>Hosting</span>
                    </div>
                  </div>
                  <button
                    className="btn-secondary host-msg"
                    disabled={!hasBooked}
                    onClick={messageHost}
                  >
                    <ChatIcon size={16} /> Message {hostFirstName}
                  </button>
                  {!hasBooked && (
                    <span className="host-msg-hint">Unlocks after you book this car</span>
                  )}
                </div>
              </div>

              <div>
                <h2>About this host</h2>
                <div className="host-about">
                  <p>
                    {hostFirstName} is an Ardena host{car.city ? ` in ${car.city}` : ''}. Ardena
                    hosts respond in under 30 minutes on average and are identity-verified before
                    their cars go live.
                  </p>
                  <p>
                    Your payment is held securely by Ardena and only released to the host after
                    pickup, with 24/7 support throughout your trip.
                  </p>
                </div>
              </div>
            </div>

            <div className="section detail-divide">
              <h2>Rental details</h2>
              <div className="detail-list">
                <div className="info-row">
                  <span>
                    <CreditCardIcon size={17} /> Price per day
                  </span>
                  <b>{formatKES(car.pricePerDay)}</b>
                </div>
                <div className="info-row">
                  <span>
                    <CalendarIcon size={17} /> Minimum rental
                  </span>
                  <b>
                    {car.minRentalDays} day{car.minRentalDays > 1 ? 's' : ''}
                  </b>
                </div>
                <div className="info-row">
                  <span>
                    <UsersIcon size={17} /> Minimum driver age
                  </span>
                  <b>{car.minAge} years</b>
                </div>
                <div className="info-row">
                  <span>
                    <SteeringIcon size={17} /> Drive options
                  </span>
                  <b>{car.driveTypes.map((t) => (t === 'self' ? 'Self drive' : 'Chauffeur')).join(' · ')}</b>
                </div>
                {car.deposit != null && (
                  <div className="info-row">
                    <span>
                      <ShieldIcon size={17} /> Refundable deposit
                    </span>
                    <b>{formatKES(car.deposit)}</b>
                  </div>
                )}
                <div className="info-row">
                  <span>
                    <MapPinIcon size={17} /> Pickup point
                  </span>
                  <b>{car.locationName}</b>
                </div>
                {car.payOnPickupAvailable && (
                  <div className="info-row">
                    <span>
                      <ClockIcon size={17} /> Pay on pickup
                    </span>
                    <b>Available</b>
                  </div>
                )}
                {car.payOnPickupAvailable && (
                  <p className="info-note">
                    Pay Ardena’s fee (plus any deposit and delivery fee) when you book, and the rest
                    when you get the car.
                  </p>
                )}
              </div>
            </div>

            {car.deliveryAvailable && (
              <div className="section detail-divide">
                <h2>Delivery</h2>
                <div className="detail-list">
                  {car.deliveryCities.map((d) => (
                    <div className="info-row" key={d.city}>
                      <span>
                        <CarIcon size={17} /> {d.city}
                      </span>
                      <b style={d.free ? { color: 'var(--success)' } : undefined}>
                        {deliveryFeeLabel(d)}
                      </b>
                    </div>
                  ))}
                  <p className="info-note">
                    Delivered to you and collected from the same address. Choose Delivery at
                    checkout.
                  </p>
                </div>
              </div>
            )}

            <PickupMap car={car} />

            <div className="section detail-divide">
              <h2>Reviews</h2>
              {ratings.loading ? (
                <p style={{ color: 'var(--text-2)' }}>Loading reviews…</p>
              ) : ratings.reviews.length === 0 ? (
                <div className="dashed-card reviews-empty">
                  <span className="reviews-empty-icon">
                    <StarIcon size={22} />
                  </span>
                  <b>No reviews yet</b>
                  <p>Be the first to rent it and share how the trip went.</p>
                </div>
              ) : (
                ratings.reviews.map((r, i) => (
                  <div className="review" key={i}>
                    <div className="r-head">
                      {r.name} <span>{r.date}</span>
                    </div>
                    <p>{r.text}</p>
                  </div>
                ))
              )}
            </div>

            <div className="section detail-divide">
              <h2>Car rules</h2>
              <div className="detail-list">
                {rules.map((r) => (
                  <div className="info-row rule" key={r}>
                    <span>
                      <BanIcon size={16} /> {r}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="section detail-divide">
              <h2>Protection</h2>
              <div className="detail-list">
                <div className="info-row">
                  <span>
                    <ShieldIcon size={17} /> Comprehensive insurance
                  </span>
                  <b>
                    <CheckIcon size={16} style={{ color: 'var(--success)' }} /> Included
                  </b>
                </div>
                <div className="info-row">
                  <span>
                    <ShieldIcon size={17} /> Damage waiver (optional)
                  </span>
                  <b>{formatKES(DAMAGE_WAIVER_PRICE_PER_DAY)}/day</b>
                </div>
                <p className="info-note">
                  The optional damage waiver reduces your liability for accidental damage during the
                  trip. You can add it at checkout.
                </p>
              </div>
            </div>

            <div className="section detail-divide">
              <h2>General policies &amp; safety</h2>
              <div className="detail-list">
                <div className="info-row rule">
                  <span>
                    <IdCardIcon size={16} /> A valid driver&apos;s licence is required for
                    self-drive trips
                  </span>
                </div>
                <div className="info-row rule">
                  <span>
                    <ShieldIcon size={16} /> Seatbelts on for every passenger, at all times
                  </span>
                </div>
                <div className="info-row rule">
                  <span>
                    <MapPinIcon size={16} /> Keep to public roads and observe speed limits; trips
                    may be GPS tracked
                  </span>
                </div>
                <div className="info-row rule">
                  <span>
                    <PhoneIcon size={16} /> 24/7 support on +254 707 856 829 if anything goes wrong
                  </span>
                </div>
                <div className="info-row rule">
                  <span>
                    <BanIcon size={16} /> Report any accident or damage to your host and Ardena
                    immediately
                  </span>
                </div>
              </div>
            </div>

            <div className="section detail-divide">
              <h2>Cancellation policy</h2>
              <div className="detail-list">
                <div className="info-row">
                  <span>
                    <CheckIcon size={16} style={{ color: 'var(--success)' }} /> Free cancellation up
                    to 48 hours before pickup
                  </span>
                </div>
                <div className="info-row">
                  <span>
                    <BanIcon size={16} /> 50% refund between 48 and 24 hours before pickup
                  </span>
                </div>
                <div className="info-row">
                  <span>
                    <BanIcon size={16} /> No refund within 24 hours of pickup
                  </span>
                </div>
              </div>
            </div>

            <div className="section detail-divide">
              <ReportListing carId={car.id} />
            </div>
          </div>

          <aside className="book-widget">
            <div className="price-line">
              {formatKES(car.pricePerDay)} <span>/ day</span>
            </div>
            <div className="widget-rows">
              <div className="widget-row">
                <span>Minimum rental</span>
                <b>
                  {car.minRentalDays} day{car.minRentalDays > 1 ? 's' : ''}
                </b>
              </div>
              <div className="widget-row">
                <span>Minimum age</span>
                <b>{car.minAge} years</b>
              </div>
              {car.deliveryAvailable && (
                <div className="widget-row">
                  <span>Delivery</span>
                  <b>{deliveryBadge(car) === 'Free delivery' ? 'Free' : 'Available'}</b>
                </div>
              )}
              {car.payOnPickupAvailable && (
                <div className="widget-row">
                  <span>Pay on pickup</span>
                  <b>Available</b>
                </div>
              )}
              <div className="widget-row">
                <span>Rating</span>
                <b>
                  <StarIcon size={12} /> {ratingLabel(car)} ({reviewCount})
                </b>
              </div>
            </div>
            <button className="btn-primary btn-block cta-desktop-only" onClick={startBooking}>
              Reserve
            </button>
            <p className="widget-foot">You won&apos;t be charged until you confirm payment.</p>
          </aside>
        </div>
      </div>

      <StickyActionBar
        info={
          <>
            <b>{formatKES(car.pricePerDay)}</b>
            <span className="unit">/ day</span>
          </>
        }
      >
        <button className="btn-primary" onClick={startBooking}>
          Reserve
        </button>
      </StickyActionBar>
    </div>
  );
}
