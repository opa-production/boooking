import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import * as api from '../api.js';
import { formatKES } from '../data.js';
import { mapBooking } from '../cars.js';
import { BackButton, EmptyState } from '../components.jsx';
import { useToast } from '../toast.jsx';
import PinMap from '../PinMap.jsx';
import {
  ensureMpesaMethod,
  defaultMpesaNumber,
  pollPayment,
  openPaystack,
  onPaymentReturn,
  MPESA_POLL_TRIES,
  CARD_POLL_TRIES,
} from '../payments.js';
import { setPendingDriverHire } from '../driverHandoff.js';
import {
  StarIcon,
  MapPinIcon,
  CalendarIcon,
  ClockIcon,
  CheckIcon,
  ShieldIcon,
  ChatIcon,
  PhoneIcon,
  CreditCardIcon,
  CarIcon,
  UsersIcon,
  SteeringIcon,
} from '../icons.jsx';

// Ardena Chauffeurs, renter side: find a driver, see their profile, hire them,
// pay, and follow the hire. Same API as the app (drivers.md). The server
// prices every hire; we only show its numbers.

const VEHICLE_TYPES = ['Saloon', 'SUV', 'Pickup', 'Van / Minibus', 'Luxury', 'Electric', 'Automatic', 'Manual'];
const TOWNS = ['Nakuru', 'Nairobi', 'Mombasa', 'Kisumu', 'Eldoret', 'Naivasha', 'Thika'];
const CANCEL_REASONS = ['Plans changed', 'Found another driver', 'Booked by mistake', 'Other'];
const MIN_HOURS = 2;
const MAX_HOURS = 12;
const MAX_DAYS = 30;

const HIRE_STATUS = {
  pending: { pill: 'pending', label: 'Waiting for the driver' },
  accepted: { pill: 'confirmed', label: 'Accepted' },
  in_progress: { pill: 'active', label: 'On the trip' },
  completed: { pill: 'completed', label: 'Completed' },
  declined: { pill: 'rejected', label: 'Declined' },
  cancelled: { pill: 'cancelled', label: 'Cancelled' },
};

/** Local date + time in Nairobi as the API expects it: 2030-01-01T09:00:00+03:00. */
const nairobiInstant = (date, time) => `${date}T${time}:00+03:00`;

function tomorrowISO() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDaysISO(iso, n) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fmtWhen(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-KE', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function fmtDay(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
}

function hireLength(h) {
  return h.mode === 'hours'
    ? `${h.hours} hour${h.hours === 1 ? '' : 's'}`
    : `${h.days} day${h.days === 1 ? '' : 's'}`;
}

function DriverPhoto({ driver, size = 56 }) {
  const [failed, setFailed] = useState(false);
  const name = driver?.display_name || driver?.first_name || 'Driver';
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}>
      {driver?.photo_url && !failed ? (
        <img src={driver.photo_url} alt={name} onError={() => setFailed(true)} />
      ) : (
        name[0]
      )}
    </span>
  );
}

function Rating({ driver }) {
  return driver.rating ? (
    <>
      <StarIcon size={12} /> {Number(driver.rating).toFixed(1)}
      {driver.reviews_count ? ` (${driver.reviews_count})` : ''}
    </>
  ) : (
    'New'
  );
}

/** Map markers for drivers: live → a pin, base → a soft circle, none → nothing. */
function driverMarkers(drivers) {
  return drivers
    .filter((d) => d.location)
    .map((d) => ({
      lat: d.location.lat,
      lng: d.location.lng,
      kind: d.location.source === 'live' ? 'live' : 'base',
      title: d.location.source === 'live' ? `${d.display_name}, here now` : `${d.display_name}, usually around here`,
    }));
}

// ---------- Find a driver ----------

export function FindDrivers() {
  const [town, setTown] = useState('Nakuru');
  const [near, setNear] = useState(null); // { lat, lng }
  const [withDates, setWithDates] = useState(false);
  const [date, setDate] = useState(tomorrowISO());
  const [time, setTime] = useState('09:00');
  const [endDate, setEndDate] = useState(tomorrowISO());
  const [endTime, setEndTime] = useState('17:00');
  const [vehicle, setVehicle] = useState('');
  const [drivers, setDrivers] = useState(null);
  const [loading, setLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState('');

  const search = async (override = {}) => {
    const where = override.near !== undefined ? override.near : near;
    const params = { vehicle_type: vehicle || undefined };
    if (where) {
      params.lat = where.lat;
      params.lng = where.lng;
    } else {
      params.town = town.trim();
    }
    if (withDates) {
      params.start = nairobiInstant(date, time);
      params.end = nairobiInstant(endDate, endTime);
    }
    setLoading(true);
    setError('');
    try {
      setDrivers(await api.searchChauffeurs(params));
    } catch (e) {
      setError(e.message || 'Couldn’t search for drivers. Please try again.');
      setDrivers([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nearMe = () => {
    if (!navigator.geolocation) {
      setError('Your browser can’t share your location. Search by town instead.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setNear(here);
        search({ near: here });
      },
      (err) => {
        setLocating(false);
        setError(err.code === 1 ? 'Location is blocked for this site. Search by town instead.' : 'Couldn’t get your location.');
      },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 120000 }
    );
  };

  const markers = drivers ? driverMarkers(drivers) : [];
  const mapCentre = near || (markers[0] ? { lat: markers[0].lat, lng: markers[0].lng } : null);

  return (
    <div className="page">
      <div className="container">
        <h1 className="page-title">Hire a driver</h1>
        <p className="page-sub">Verified Ardena chauffeurs, for your own car or an Ardena car.</p>

        <form
          className="form-card driver-search"
          onSubmit={(e) => {
            e.preventDefault();
            setNear(null);
            search({ near: null });
          }}
        >
          <div className="driver-search-row">
            <div className="field">
              <label>Town</label>
              <div className="control">
                <MapPinIcon size={16} style={{ color: 'var(--hint)' }} />
                <input
                  list="driver-towns"
                  value={near ? 'Near me' : town}
                  onChange={(e) => {
                    setNear(null);
                    setTown(e.target.value);
                  }}
                  placeholder="e.g. Nakuru"
                />
                <datalist id="driver-towns">
                  {TOWNS.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </div>
            </div>
            <div className="field">
              <label>Car type</label>
              <div className="control">
                <select value={vehicle} onChange={(e) => setVehicle(e.target.value)}>
                  <option value="">Any</option>
                  {VEHICLE_TYPES.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="toggle-row" style={{ margin: '4px 0 14px' }}>
            <div className="t-label">
              <b>Pick a time</b>
              <span>{withDates ? 'Only drivers free then' : 'Showing drivers online now'}</span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={withDates}
              className={`switch${withDates ? ' on' : ''}`}
              onClick={() => setWithDates((v) => !v)}
            />
          </div>
          {withDates && (
            <div className="driver-search-row four">
              <div className="field">
                <label>From</label>
                <div className="control">
                  <input type="date" value={date} min={tomorrowISO()} onChange={(e) => {
                    setDate(e.target.value);
                    if (endDate < e.target.value) setEndDate(e.target.value);
                  }} />
                </div>
              </div>
              <div className="field">
                <label>Time</label>
                <div className="control">
                  <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
                </div>
              </div>
              <div className="field">
                <label>Until</label>
                <div className="control">
                  <input type="date" value={endDate} min={date} onChange={(e) => setEndDate(e.target.value)} />
                </div>
              </div>
              <div className="field">
                <label>Time</label>
                <div className="control">
                  <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                </div>
              </div>
            </div>
          )}

          <div className="driver-search-actions">
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Searching…' : 'Search'}
            </button>
            <button type="button" className="btn-secondary" onClick={nearMe} disabled={locating || loading}>
              <MapPinIcon size={15} /> {locating ? 'Finding you…' : 'Near me'}
            </button>
          </div>
          {error && <p className="form-error">{error}</p>}
        </form>

        {mapCentre && markers.length > 0 && (
          <div className="section">
            <PinMap lat={mapCentre.lat} lng={mapCentre.lng} zoom={12} height={280} markers={markers} label="Drivers on the map" />
            <p className="info-note">
              A dot is where a driver is now. A soft circle is the area they usually work from.
            </p>
          </div>
        )}

        <div className="section">
          {drivers === null || (loading && !drivers.length) ? (
            <div className="driver-grid">
              {Array.from({ length: 4 }, (_, i) => (
                <div className="driver-card" key={i} aria-hidden="true">
                  <span className="skel-circle" style={{ width: 56, height: 56 }} />
                  <div style={{ flex: 1 }}>
                    <div className="skel-line" style={{ width: '50%', marginTop: 0 }} />
                    <div className="skel-line" style={{ width: '80%' }} />
                  </div>
                </div>
              ))}
            </div>
          ) : drivers.length === 0 ? (
            <EmptyState
              variant="compact"
              icon={<UsersIcon size={22} />}
              title="No drivers found"
              message={
                withDates
                  ? 'Nobody is free then. Try other times or another town.'
                  : 'Nobody is online right now. Pick a time to see who can drive then.'
              }
            />
          ) : (
            <div className="driver-grid">
              {drivers.map((d) => (
                <Link to={`/chauffeurs/${d.id}`} className="driver-card" key={d.id}>
                  <DriverPhoto driver={d} />
                  <div className="driver-main">
                    <b>
                      {d.display_name}
                      {d.available_now && <span className="avail-dot" title="Available now" />}
                    </b>
                    <span className="car-meta">
                      <Rating driver={d} /> · {d.trips_count} trip{d.trips_count === 1 ? '' : 's'} ·{' '}
                      {d.years_experience} yr{d.years_experience === 1 ? '' : 's'} driving
                    </span>
                    <span className="car-meta">
                      <MapPinIcon size={12} /> {d.base_town}
                      {d.distance_km != null ? ` · ${d.distance_km} km away` : ''}
                      {d.languages?.length ? ` · ${d.languages.slice(0, 3).join(', ')}` : ''}
                    </span>
                  </div>
                  <div className="driver-price">
                    {d.daily && (
                      <span>
                        <b>{formatKES(d.price_per_day)}</b>/day
                      </span>
                    )}
                    {d.hourly && (
                      <span>
                        <b>{formatKES(d.price_per_hour)}</b>/hr
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- Driver profile ----------

export function DriverProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [driver, setDriver] = useState(null);
  const [error, setError] = useState('');
  const [reviews, setReviews] = useState([]);
  const [nextPage, setNextPage] = useState(null);
  const [moreBusy, setMoreBusy] = useState(false);

  useEffect(() => {
    let on = true;
    api
      .getChauffeur(id)
      .then((d) => {
        if (!on) return;
        setDriver(d);
        setReviews(d.reviews || []);
        setNextPage((d.reviews || []).length < (d.reviews_count || 0) ? 1 : null);
      })
      .catch((e) => {
        if (on) setError(e.message || 'Couldn’t load this driver.');
      });
    return () => {
      on = false;
    };
  }, [id]);

  const loadMore = async () => {
    if (moreBusy || nextPage == null) return;
    setMoreBusy(true);
    try {
      const data = await api.getChauffeurReviews(id, nextPage);
      setReviews((prev) => {
        const seen = new Set(prev.map((r) => r.id));
        return [...prev, ...(data.results || []).filter((r) => !seen.has(r.id))];
      });
      setNextPage(data.next_page);
    } catch {
      setNextPage(null);
    } finally {
      setMoreBusy(false);
    }
  };

  if (error) {
    return (
      <div className="page container">
        <div className="empty">
          {error} <Link to="/chauffeurs">Find another driver</Link>
        </div>
      </div>
    );
  }
  if (!driver) {
    return (
      <div className="page container">
        <div className="form-card">
          <span className="skel-circle" style={{ width: 88, height: 88 }} />
          <div className="skel-line" style={{ width: '40%', height: 22 }} />
          <div className="skel-line" style={{ width: '70%' }} />
        </div>
      </div>
    );
  }

  const loc = driver.location;
  const verified = driver.verified || {};
  const avail = driver.availability || {};

  return (
    <div className="page">
      <div className="container">
        <BackButton to="/chauffeurs" />
        <div className="details-layout" style={{ marginTop: 26 }}>
          <div>
            <div className="trip-head dashed-card">
              <DriverPhoto driver={driver} size={88} />
              <div className="trip-head-main">
                <h1 className="page-title" style={{ marginBottom: 4 }}>
                  {driver.display_name}
                </h1>
                <div className="rating-line">
                  <Rating driver={driver} /> · {driver.trips_count} trip{driver.trips_count === 1 ? '' : 's'}
                  {driver.response_time ? ` · ${driver.response_time}` : ''}
                </div>
                <div className="detail-badges">
                  {driver.available_now && <span className="car-badge inline ok">Available now</span>}
                  {verified.identity && (
                    <span className="car-badge inline">
                      <ShieldIcon size={13} /> ID checked
                    </span>
                  )}
                  {verified.licence && (
                    <span className="car-badge inline">
                      <CheckIcon size={13} /> Licence verified
                    </span>
                  )}
                  {verified.background && (
                    <span className="car-badge inline">
                      <CheckIcon size={13} /> Background checked
                    </span>
                  )}
                </div>
              </div>
            </div>

            {driver.bio && <p className="dashed-card car-desc">{driver.bio}</p>}

            <div className="section">
              <h2>Details</h2>
              <div className="info-card">
                <div className="info-row">
                  <span>
                    <SteeringIcon size={17} /> Experience
                  </span>
                  <b>
                    {driver.years_experience} year{driver.years_experience === 1 ? '' : 's'}
                  </b>
                </div>
                {driver.languages?.length > 0 && (
                  <div className="info-row">
                    <span>
                      <ChatIcon size={17} /> Languages
                    </span>
                    <b>{driver.languages.join(', ')}</b>
                  </div>
                )}
                <div className="info-row">
                  <span>
                    <MapPinIcon size={17} /> Based in
                  </span>
                  <b>{driver.base_town}</b>
                </div>
                <div className="info-row">
                  <span>
                    <MapPinIcon size={17} /> Covers
                  </span>
                  <b>
                    {driver.nationwide
                      ? 'All of Kenya'
                      : [driver.base_town, ...(driver.areas_served || [])].filter(Boolean).join(', ')}
                  </b>
                </div>
                {avail.days?.length > 0 && (
                  <div className="info-row">
                    <span>
                      <ClockIcon size={17} /> Works
                    </span>
                    <b>
                      {avail.days.join(', ')} · {avail.start}–{avail.end}
                    </b>
                  </div>
                )}
                {driver.vehicle_types?.length > 0 && (
                  <div className="info-row">
                    <span>
                      <CarIcon size={17} /> Drives
                    </span>
                    <b>{driver.vehicle_types.join(', ')}</b>
                  </div>
                )}
              </div>
            </div>

            {loc && (
              <div className="section">
                <h2>{loc.source === 'live' ? 'Where they are now' : 'Usually around here'}</h2>
                <PinMap
                  lat={loc.lat}
                  lng={loc.lng}
                  zoom={loc.source === 'live' ? 14 : 12}
                  markers={[{ lat: loc.lat, lng: loc.lng, kind: loc.source === 'live' ? 'live' : 'base' }]}
                  label={loc.source === 'live' ? 'Driver’s location' : 'The area this driver usually works from'}
                />
              </div>
            )}

            <div className="section">
              <h2>Reviews</h2>
              {reviews.length === 0 ? (
                <div className="dashed-card reviews-empty">
                  <span className="reviews-empty-icon">
                    <StarIcon size={22} />
                  </span>
                  <b>No reviews yet</b>
                  <p>Hire {driver.first_name} and be the first to rate the trip.</p>
                </div>
              ) : (
                <>
                  {reviews.map((r) => (
                    <div className="review" key={r.id}>
                      <div className="r-head">
                        {r.author} <span>{'★'.repeat(r.rating)} · {fmtDay(r.date)}</span>
                      </div>
                      {r.text && <p>{r.text}</p>}
                    </div>
                  ))}
                  {nextPage != null && (
                    <button className="btn-secondary" onClick={loadMore} disabled={moreBusy}>
                      {moreBusy ? 'Loading…' : 'More reviews'}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          <aside className="book-widget">
            {driver.daily && (
              <div className="price-line">
                {formatKES(driver.price_per_day)} <span>/ day</span>
              </div>
            )}
            {driver.hourly && (
              <div className="price-line" style={{ fontSize: 'var(--fs-lg)' }}>
                {formatKES(driver.price_per_hour)} <span>/ hour</span>
              </div>
            )}
            <div className="widget-rows">
              <div className="widget-row">
                <span>Service</span>
                <b>{driver.service_type === 'car_and_driver' ? 'Car and driver' : 'Driver only'}</b>
              </div>
              <div className="widget-row">
                <span>Rating</span>
                <b>
                  <Rating driver={driver} />
                </b>
              </div>
            </div>
            <button className="btn-primary btn-block" onClick={() => navigate(`/chauffeurs/${driver.id}/hire`)}>
              Hire {driver.first_name}
            </button>
            <p className="widget-foot">The driver confirms before you’re charged anything extra.</p>
          </aside>
        </div>
      </div>
    </div>
  );
}

// ---------- Hire ----------

export function HireDriver() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [driver, setDriver] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [mode, setMode] = useState('days');
  const [date, setDate] = useState(tomorrowISO());
  const [time, setTime] = useState('09:00');
  const [days, setDays] = useState(1);
  const [hours, setHours] = useState(4);
  const [pickup, setPickup] = useState('');
  const [pickupPin, setPickupPin] = useState(null);
  const [dropoff, setDropoff] = useState('');
  const [carSource, setCarSource] = useState('own');
  const [ownCar, setOwnCar] = useState('');
  const [ownTransmission, setOwnTransmission] = useState('Automatic');
  const [carBookings, setCarBookings] = useState([]);
  const [carBookingId, setCarBookingId] = useState(''); // '' = book an Ardena car next
  const [notes, setNotes] = useState('');
  const [payment, setPayment] = useState('pay_now');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    let on = true;
    api
      .getChauffeur(id)
      .then((d) => {
        if (!on) return;
        setDriver(d);
        if (!d.daily && d.hourly) setMode('hours');
      })
      .catch((e) => {
        if (on) setLoadError(e.message || 'Couldn’t load this driver.');
      });
    // Paid car bookings this driver could go with.
    api
      .listBookings()
      .then((data) => {
        if (on) setCarBookings((data.bookings || []).filter((b) => ['confirmed', 'active'].includes(b.status)).map(mapBooking));
      })
      .catch(() => {});
    return () => {
      on = false;
    };
  }, [id]);

  const locate = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setPickupPin({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  };

  if (loadError) {
    return (
      <div className="page container">
        <div className="empty">
          {loadError} <Link to="/chauffeurs">Find another driver</Link>
        </div>
      </div>
    );
  }
  if (!driver) {
    return (
      <div className="page container">
        <div className="empty">Loading…</div>
      </div>
    );
  }

  const linkedCar = carBookings.find((b) => b.id === carBookingId);
  const missing = [];
  if (pickup.trim().length < 3) missing.push('a pickup address');
  if (carSource === 'own' && ownCar.trim().length < 2) missing.push('your car');

  const submit = async () => {
    if (busy || missing.length) return;
    setBusy(true);
    setError('');
    const payload = {
      chauffeur_id: driver.id,
      mode,
      start: nairobiInstant(date, time),
      ...(mode === 'days' ? { days: Number(days) } : { hours: Number(hours) }),
      pickup_location: pickup.trim(),
      ...(pickupPin ? { pickup_lat: pickupPin.lat, pickup_lng: pickupPin.lng } : {}),
      dropoff_location: dropoff.trim() || null,
      car_source: carSource,
      notes: notes.trim() || null,
      payment_method: payment,
    };
    if (carSource === 'own') {
      payload.own_car = { description: ownCar.trim(), transmission: ownTransmission };
    } else if (carBookingId) {
      payload.car_booking_id = carBookingId;
      payload.car_name = linkedCar?.car.name || null;
    }
    try {
      const hire = await api.createChauffeurHire(payload);
      if (hire.car_to_follow) setPendingDriverHire({ id: hire.id, name: driver.display_name });
      navigate(`/driver-hires/${hire.id}`, { replace: true, state: { justCreated: true } });
    } catch (e) {
      setError(e.message || 'Couldn’t send the request. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="container">
        <BackButton to={`/chauffeurs/${driver.id}`} />
        <div className="booking-layout" style={{ marginTop: 26 }}>
          <div className="form-card">
            <h1 className="page-title" style={{ fontSize: 'var(--fs-xl)' }}>
              Hire {driver.first_name}
            </h1>

            {driver.daily && driver.hourly && (
              <div className="field">
                <label>
                  How long <span className="choose-hint">choose one</span>
                </label>
                <div className="seg">
                  <button type="button" className={`choice-btn${mode === 'days' ? ' selected' : ''}`} onClick={() => setMode('days')}>
                    <span className="radio-dot" /> By the day
                  </button>
                  <button type="button" className={`choice-btn${mode === 'hours' ? ' selected' : ''}`} onClick={() => setMode('hours')}>
                    <span className="radio-dot" /> By the hour
                  </button>
                </div>
              </div>
            )}

            <div className="two-col">
              <div className="field">
                <label>Start date</label>
                <div className="control">
                  <input type="date" value={date} min={tomorrowISO()} max={addDaysISO(tomorrowISO(), 179)} onChange={(e) => setDate(e.target.value)} />
                </div>
              </div>
              <div className="field">
                <label>Pickup time</label>
                <div className="control">
                  <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
                </div>
              </div>
              <div className="field">
                <label>{mode === 'days' ? 'Days' : 'Hours'}</label>
                <div className="control">
                  {mode === 'days' ? (
                    <select value={days} onChange={(e) => setDays(e.target.value)}>
                      {Array.from({ length: MAX_DAYS }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={n}>
                          {n} day{n === 1 ? '' : 's'}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <select value={hours} onChange={(e) => setHours(e.target.value)}>
                      {Array.from({ length: MAX_HOURS - MIN_HOURS + 1 }, (_, i) => i + MIN_HOURS).map((n) => (
                        <option key={n} value={n}>
                          {n} hours
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            </div>

            <div className="field">
              <label>Pickup address</label>
              <div className="control">
                <MapPinIcon size={16} style={{ color: 'var(--hint)' }} />
                <input value={pickup} maxLength={500} onChange={(e) => setPickup(e.target.value)} placeholder="Where the driver meets you" />
              </div>
              <div className="locate-row">
                {pickupPin ? (
                  <span className="locate-done">
                    <MapPinIcon size={14} /> Your location is attached
                    <button type="button" className="link" onClick={() => setPickupPin(null)}>
                      Remove
                    </button>
                  </span>
                ) : (
                  <button type="button" className="link" onClick={locate} disabled={locating}>
                    {locating ? 'Finding you…' : 'Attach my current location'}
                  </button>
                )}
              </div>
            </div>
            <div className="field">
              <label>
                Drop-off <span className="choose-hint">optional</span>
              </label>
              <div className="control">
                <input value={dropoff} maxLength={500} onChange={(e) => setDropoff(e.target.value)} placeholder="Where the trip ends, if somewhere else" />
              </div>
            </div>

            <div className="field">
              <label>
                Whose car <span className="choose-hint">choose one</span>
              </label>
              <div className="seg">
                <button type="button" className={`choice-btn${carSource === 'own' ? ' selected' : ''}`} onClick={() => setCarSource('own')}>
                  <span className="radio-dot" /> My own car
                </button>
                <button type="button" className={`choice-btn${carSource === 'ardena' ? ' selected' : ''}`} onClick={() => setCarSource('ardena')}>
                  <span className="radio-dot" /> An Ardena car
                </button>
              </div>
            </div>

            {carSource === 'own' ? (
              <div className="two-col">
                <div className="field">
                  <label>Your car</label>
                  <div className="control">
                    <input value={ownCar} maxLength={200} onChange={(e) => setOwnCar(e.target.value)} placeholder="e.g. White Toyota Prado, KDA 123A" />
                  </div>
                </div>
                <div className="field">
                  <label>Transmission</label>
                  <div className="control">
                    <select value={ownTransmission} onChange={(e) => setOwnTransmission(e.target.value)}>
                      <option>Automatic</option>
                      <option>Manual</option>
                    </select>
                  </div>
                </div>
              </div>
            ) : (
              <div className="field">
                <label>Which Ardena car</label>
                <div className="control">
                  <select value={carBookingId} onChange={(e) => setCarBookingId(e.target.value)}>
                    <option value="">I’ll book a car next (no licence needed)</option>
                    {carBookings.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.car.name} · {b.pickupDate} → {b.dropoffDate}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="field-hint">
                  {carBookingId
                    ? 'The driver goes with this paid booking.'
                    : 'Hire the driver first, then pick a car. That booking is chauffeur-driven, so you won’t need a driving licence.'}
                </p>
              </div>
            )}

            <div className="field">
              <label>
                Notes for {driver.first_name} <span className="choose-hint">optional</span>
              </label>
              <div className="control" style={{ height: 'auto' }}>
                <textarea rows={3} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Airport run, child seat, a stop on the way…" />
              </div>
            </div>

            <div className="field">
              <label>
                How you pay <span className="choose-hint">choose one</span>
              </label>
              <div className="seg">
                <button type="button" className={`choice-btn${payment === 'pay_now' ? ' selected' : ''}`} onClick={() => setPayment('pay_now')}>
                  <span className="radio-dot" />
                  <CreditCardIcon size={16} /> Pay now
                </button>
                <button type="button" className={`choice-btn${payment === 'cash' ? ' selected' : ''}`} onClick={() => setPayment('cash')}>
                  <span className="radio-dot" /> Cash to the driver
                </button>
              </div>
              <p className="field-hint">
                {payment === 'pay_now'
                  ? 'Pay by M-Pesa or card on the next step. The request goes to the driver once it’s paid.'
                  : 'The request goes to the driver now. Pay them in cash on the day.'}
              </p>
            </div>

            {error && <p className="form-error">{error}</p>}
            <button className="btn-primary btn-block" disabled={busy || missing.length > 0} onClick={submit}>
              {busy ? 'Sending…' : payment === 'pay_now' ? 'Continue to payment' : `Send request to ${driver.first_name}`}
            </button>
            {missing.length > 0 && (
              <p className="missing-hint">
                Still needed: <b>{missing.join(' · ')}</b>
              </p>
            )}
          </div>

          <aside className="side-sticky">
            <div className="form-card">
              <div className="mini-car">
                <DriverPhoto driver={driver} />
                <div>
                  <b>{driver.display_name}</b>
                  <div className="car-meta">
                    <Rating driver={driver} /> · {driver.base_town}
                  </div>
                </div>
              </div>
              <div className="breakdown">
                <div className="row">
                  <span>Rate</span>
                  <span>
                    {mode === 'days'
                      ? `${formatKES(driver.price_per_day)} / day`
                      : `${formatKES(driver.price_per_hour)} / hour`}
                  </span>
                </div>
                <div className="row">
                  <span>Length</span>
                  <span>{mode === 'days' ? `${days} day${Number(days) === 1 ? '' : 's'}` : `${hours} hours`}</span>
                </div>
                <p className="breakdown-note">Ardena prices the hire when you send it. You’ll see the total before paying.</p>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

// ---------- One hire ----------

function HirePay({ hire, onPaid }) {
  const [method, setMethod] = useState('mpesa');
  const [phone, setPhone] = useState('');
  const [phase, setPhase] = useState('idle');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const cancelled = useRef(false);
  const wake = useRef(null);

  useEffect(() => {
    cancelled.current = false;
    defaultMpesaNumber().then((n) => n && setPhone((p) => p || n));
    const off = onPaymentReturn(() => wake.current && wake.current());
    return () => {
      cancelled.current = true;
      off();
    };
  }, []);

  const pay = async () => {
    if (phase !== 'idle') return;
    setError('');
    setNote('');
    setPhase('working');
    try {
      const methodId = method === 'mpesa' ? await ensureMpesaMethod(phone) : null;
      const res = await api.payChauffeurHire(hire.id, methodId);
      let params;
      if (method === 'mpesa') {
        setNote('STK push sent. Enter your M-Pesa PIN on your phone to pay.');
        params = { checkout_request_id: res.checkout_request_id || res.transaction_id };
      } else {
        if (!res.redirect_url) throw new Error('Card payment could not be started.');
        if (!openPaystack(res.redirect_url)) return;
        setNote('Complete the card payment in the Paystack tab. We’ll confirm here.');
        params = { paystack_reference: res.transaction_id || res.checkout_request_id };
      }
      setPhase('waiting');
      const status = await pollPayment(params, {
        tries: method === 'mpesa' ? MPESA_POLL_TRIES : CARD_POLL_TRIES,
        isCancelled: () => cancelled.current,
        wake,
      });
      if (!status) return;
      if (status.status === 'completed') {
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

  const busy = phase !== 'idle';
  return (
    <div className="section">
      <h2>Pay for this hire</h2>
      <div className="info-card">
        <div className="info-row">
          <span>
            <CreditCardIcon size={17} /> Total
          </span>
          <b style={{ fontSize: 'var(--fs-md)' }}>{formatKES(hire.total)}</b>
        </div>
        <div className="seg" style={{ padding: '14px 0 0' }}>
          <button className={`choice-btn${method === 'mpesa' ? ' selected' : ''}`} onClick={() => setMethod('mpesa')} disabled={busy}>
            <span className="radio-dot" />
            <PhoneIcon size={16} /> M-Pesa
          </button>
          <button className={`choice-btn${method === 'card' ? ' selected' : ''}`} onClick={() => setMethod('card')} disabled={busy}>
            <span className="radio-dot" />
            <CreditCardIcon size={16} /> Card
          </button>
        </div>
        <div className="ext-pay">
          {method === 'mpesa' && (
            <div className="ext-phone">
              <PhoneIcon size={16} />
              <input type="tel" placeholder="07XX XXX XXX" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={busy} />
            </div>
          )}
          <button className="btn-primary ext-pay-btn" onClick={pay} disabled={busy}>
            {phase === 'working' ? 'Starting…' : phase === 'waiting' ? 'Waiting for payment…' : `Pay ${formatKES(hire.total)}`}
          </button>
        </div>
        <p className="info-note">The request goes to {hire.chauffeur.first_name} once it’s paid. A declined request is refunded in full.</p>
        {note && <p className="info-note" style={{ color: 'var(--success)', fontWeight: 700 }}>{note}</p>}
        {error && <p className="info-note" style={{ color: 'var(--error)', fontWeight: 700 }}>{error}</p>}
      </div>
    </div>
  );
}

function RateHire({ hire, onRated }) {
  const [rating, setRating] = useState(0);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const send = async () => {
    if (busy || !rating) return;
    setBusy(true);
    setError('');
    try {
      onRated(await api.reviewChauffeurHire(hire.id, rating, text.trim()));
    } catch (e) {
      setError(e.message || 'Couldn’t send your rating.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="section">
      <h2>Rate {hire.chauffeur.first_name}</h2>
      <div className="info-card" style={{ paddingBottom: 16 }}>
        <div className="star-pick" role="radiogroup" aria-label="Rating">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={rating === n}
              aria-label={`${n} star${n === 1 ? '' : 's'}`}
              className={n <= rating ? 'on' : ''}
              onClick={() => setRating(n)}
            >
              ★
            </button>
          ))}
        </div>
        <div className="control" style={{ height: 'auto' }}>
          <textarea rows={3} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} placeholder="How was the trip? (optional)" />
        </div>
        {error && <p className="form-error">{error}</p>}
        <button className="btn-primary" style={{ marginTop: 'var(--sp-3)' }} onClick={send} disabled={busy || !rating}>
          {busy ? 'Sending…' : 'Send rating'}
        </button>
      </div>
    </div>
  );
}

export function DriverHireDetails() {
  const { id } = useParams();
  const { state } = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const [hire, setHire] = useState(null);
  const [error, setError] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState(CANCEL_REASONS[0]);
  const [cancelling, setCancelling] = useState(false);
  const [actionError, setActionError] = useState('');

  const load = () =>
    api
      .getChauffeurHire(id)
      .then(setHire)
      .catch((e) => setError(e.message || 'Couldn’t load this hire.'));

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (error) {
    return (
      <div className="page container">
        <div className="empty">
          {error} <Link to="/trips?tab=drivers">My driver hires</Link>
        </div>
      </div>
    );
  }
  if (!hire) {
    return (
      <div className="page container">
        <div className="form-card">
          <div className="skel-line" style={{ width: '45%', height: 22, marginTop: 0 }} />
          <div className="skel-line" style={{ width: '100%', height: 120 }} />
        </div>
      </div>
    );
  }

  const s = HIRE_STATUS[hire.status] || { pill: 'pending', label: hire.status };
  const unpaid = hire.payment_method === 'pay_now' && hire.payment_status === 'unpaid' && hire.status === 'pending';
  const canCancel = ['pending', 'accepted'].includes(hire.status);
  const canChat = !['declined', 'cancelled'].includes(hire.status) && !unpaid;
  const needsCar = hire.car_to_follow && !hire.car_booking_id && !['declined', 'cancelled'].includes(hire.status);
  const driver = hire.chauffeur;

  const cancel = async () => {
    if (cancelling) return;
    setCancelling(true);
    setActionError('');
    try {
      const updated = await api.cancelChauffeurHire(hire.id, reason);
      setHire(updated);
      setCancelOpen(false);
      toast.success(updated.refund_amount > 0 ? `Cancelled. ${formatKES(updated.refund_amount)} is on its way back.` : 'Hire cancelled');
    } catch (e) {
      setActionError(e.message || 'Couldn’t cancel this hire.');
    } finally {
      setCancelling(false);
    }
  };

  const bookCar = () => {
    setPendingDriverHire({ id: hire.id, name: driver.display_name });
    navigate('/');
  };

  return (
    <div className="page trip-detail">
      <div className="container">
        <BackButton to="/trips?tab=drivers" />
        <div className="details-layout" style={{ marginTop: 26 }}>
          <div>
            <div className="trip-head dashed-card">
              <DriverPhoto driver={driver} size={88} />
              <div className="trip-head-main">
                <div className="trip-title" style={{ gap: 14 }}>
                  <h1 className="page-title" style={{ marginBottom: 0 }}>
                    {driver.display_name}
                  </h1>
                  <span className={`status-pill ${s.pill}`}>{s.label}</span>
                </div>
                <div className="rating-line" style={{ marginTop: 6 }}>
                  <span className="trip-code">{hire.id}</span>
                  {hire.created_at && <> · Requested {fmtDay(hire.created_at)}</>}
                </div>
              </div>
            </div>

            {state?.justCreated && !unpaid && hire.status === 'pending' && (
              <div className="notice" style={{ marginTop: 'var(--sp-4)' }}>
                Request sent to {driver.first_name}. We’ll let you know when they answer.
              </div>
            )}
            {hire.status === 'declined' && (
              <div className="notice" style={{ marginTop: 'var(--sp-4)' }}>
                {driver.first_name} can’t take this one.
                {hire.refund_amount > 0 ? ` ${formatKES(hire.refund_amount)} is refunded to you.` : ''}{' '}
                <Link to="/chauffeurs" className="link">
                  Find another driver
                </Link>
              </div>
            )}
            {hire.status === 'cancelled' && (
              <div className="notice" style={{ marginTop: 'var(--sp-4)' }}>
                This hire was cancelled{hire.cancel_reason ? `: ${hire.cancel_reason}` : '.'}
                {hire.refund_amount > 0 ? ` ${formatKES(hire.refund_amount)} refunded.` : ''}
              </div>
            )}

            {needsCar && (
              <div className="notice driver-hire-note" style={{ marginTop: 'var(--sp-4)' }}>
                <CarIcon size={16} />
                <span>
                  <b>Now choose your Ardena car.</b> {driver.first_name} drives it, so you don’t need
                  a driving licence.
                </span>
                <button className="btn-primary btn-sm" onClick={bookCar}>
                  Choose a car
                </button>
              </div>
            )}

            {unpaid && <HirePay hire={hire} onPaid={() => { load(); toast.success('Paid. Your request is with the driver.'); }} />}

            <div className="section">
              <h2>Trip</h2>
              <div className="info-card">
                <div className="info-row">
                  <span>
                    <CalendarIcon size={17} /> Starts
                  </span>
                  <b>{fmtWhen(hire.start)}</b>
                </div>
                <div className="info-row">
                  <span>
                    <ClockIcon size={17} /> Length
                  </span>
                  <b>
                    {hireLength(hire)} · until {fmtWhen(hire.end)}
                  </b>
                </div>
                <div className="info-row">
                  <span>
                    <MapPinIcon size={17} /> Pickup
                  </span>
                  <b>{hire.pickup_location}</b>
                </div>
                {hire.dropoff_location && (
                  <div className="info-row">
                    <span>
                      <MapPinIcon size={17} /> Drop-off
                    </span>
                    <b>{hire.dropoff_location}</b>
                  </div>
                )}
                <div className="info-row">
                  <span>
                    <CarIcon size={17} /> Car
                  </span>
                  <b>
                    {hire.car_source === 'own'
                      ? [hire.own_car?.description, hire.own_car?.transmission].filter(Boolean).join(' · ')
                      : hire.car_name || 'Ardena car (being booked)'}
                  </b>
                </div>
                {driver.phone && (
                  <div className="info-row">
                    <span>
                      <PhoneIcon size={17} /> Driver’s phone
                    </span>
                    <b>
                      <a href={`tel:${driver.phone}`} className="link">
                        {driver.phone}
                      </a>
                    </b>
                  </div>
                )}
                {hire.notes && <p className="info-note">Notes: {hire.notes}</p>}
              </div>
            </div>

            <div className="section">
              <h2>Payment</h2>
              <div className="info-card">
                <div className="info-row">
                  <span>
                    <CreditCardIcon size={17} /> {hireLength(hire)} at {formatKES(hire.rate)}
                    {hire.mode === 'hours' ? '/hour' : '/day'}
                  </span>
                  <b>{formatKES(hire.total)}</b>
                </div>
                <div className="info-row">
                  <span>Paying</span>
                  <b>
                    {hire.payment_method === 'cash'
                      ? 'Cash to the driver'
                      : hire.payment_status === 'paid'
                        ? `Paid${hire.paid_at ? ` on ${fmtDay(hire.paid_at)}` : ''}`
                        : hire.payment_status === 'refunded'
                          ? 'Refunded'
                          : 'Not paid yet'}
                  </b>
                </div>
              </div>
            </div>

            {hire.status === 'completed' && !hire.renter_review && <RateHire hire={hire} onRated={setHire} />}
            {hire.renter_review && (
              <div className="section">
                <h2>Your rating</h2>
                <div className="review">
                  <div className="r-head">
                    {'★'.repeat(hire.renter_review.rating)} <span>{fmtDay(hire.renter_review.created_at)}</span>
                  </div>
                  {hire.renter_review.text && <p>{hire.renter_review.text}</p>}
                </div>
              </div>
            )}
          </div>

          <aside className="side-sticky">
            <div className="book-widget">
              <div className="mini-car">
                <DriverPhoto driver={driver} />
                <div>
                  <b>{driver.display_name}</b>
                  <div className="car-meta">
                    <Rating driver={driver} />
                  </div>
                </div>
              </div>
              {canChat && (
                <button
                  className="btn-secondary btn-block"
                  style={{ marginTop: 'var(--sp-4)' }}
                  onClick={() => navigate('/messages', { state: { driverHireId: hire.id, driverName: driver.display_name, driverPhoto: driver.photo_url } })}
                >
                  <ChatIcon size={16} /> Message {driver.first_name}
                </button>
              )}
              <Link to={`/chauffeurs/${driver.id}`} className="link" style={{ display: 'block', textAlign: 'center', marginTop: 'var(--sp-3)', fontSize: 'var(--fs-sm)' }}>
                View profile
              </Link>
            </div>

            {canCancel && (
              <div className="book-widget" style={{ marginTop: 20 }}>
                {cancelOpen ? (
                  <>
                    <div className="field" style={{ marginBottom: 12 }}>
                      <label>Why are you cancelling?</label>
                      <div className="control">
                        <select value={reason} onChange={(e) => setReason(e.target.value)}>
                          {CANCEL_REASONS.map((r) => (
                            <option key={r}>{r}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="cancel-confirm" style={{ flexWrap: 'wrap', justifyContent: 'center' }}>
                      <button className="btn-secondary danger-btn" onClick={cancel} disabled={cancelling}>
                        {cancelling ? 'Cancelling…' : 'Yes, cancel'}
                      </button>
                      <button className="btn-secondary" onClick={() => setCancelOpen(false)} disabled={cancelling}>
                        Keep it
                      </button>
                    </div>
                  </>
                ) : (
                  <button className="btn-secondary danger-btn btn-block" style={{ width: '100%' }} onClick={() => setCancelOpen(true)}>
                    Cancel hire
                  </button>
                )}
                <p className="widget-foot" style={{ marginTop: 14 }}>
                  Free until 24 hours before the trip, then 50% back. A request the driver hasn’t
                  accepted is always refunded in full.
                </p>
                {actionError && <p className="form-error">{actionError}</p>}
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

/** "Drivers" tab on My trips. */
export function DriverHiresList() {
  const [hires, setHires] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let on = true;
    api
      .listChauffeurHires()
      .then((list) => {
        if (on) setHires(Array.isArray(list) ? list : []);
      })
      .catch((e) => {
        if (on) setError(e.message || 'Couldn’t load your driver hires.');
      });
    return () => {
      on = false;
    };
  }, []);

  if (error) return <div className="empty">{error}</div>;
  if (!hires) {
    return (
      <div className="past-panel">
        <div className="past-row" aria-hidden="true">
          <span className="skel-circle" style={{ width: 56, height: 56 }} />
          <div className="past-main">
            <div className="skel-line" style={{ width: '45%', marginTop: 0 }} />
            <div className="skel-line" style={{ width: '65%' }} />
          </div>
        </div>
      </div>
    );
  }
  if (!hires.length) {
    return (
      <EmptyState
        variant="compact"
        icon={<UsersIcon size={22} />}
        title="No driver hires yet"
        message="Hire a verified Ardena chauffeur for your own car or an Ardena car."
        action={
          <Link to="/chauffeurs" className="btn-primary">
            Find a driver
          </Link>
        }
      />
    );
  }
  return (
    <div className="past-panel">
      {hires.map((h) => {
        const s = HIRE_STATUS[h.status] || { pill: 'pending', label: h.status };
        return (
          <Link to={`/driver-hires/${h.id}`} className="past-row" key={h.id}>
            <DriverPhoto driver={h.chauffeur} />
            <div className="past-main">
              <b>{h.chauffeur.display_name}</b>
              <span>
                <CalendarIcon size={13} /> {fmtWhen(h.start)} · {hireLength(h)}
              </span>
              <span>
                <MapPinIcon size={13} /> {h.pickup_location}
              </span>
            </div>
            <div className="past-side">
              <span className={`status-text ${s.pill}`}>{s.label}</span>
              <b className="past-total">{formatKES(h.total)}</b>
              <span className="past-days">{h.payment_method === 'cash' ? 'Cash' : h.payment_status === 'paid' ? 'Paid' : 'Not paid'}</span>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
