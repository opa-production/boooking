import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { formatKES } from '../data.js';
import { fmtShort } from '../Calendar.jsx';
import { mapBooking, useCars, ratingLabel } from '../cars.js';
import { CarPhoto, EmptyState } from '../components.jsx';
import { listBookings, deleteBookingRecord } from '../api.js';
import { useToast } from '../toast.jsx';
import { DriverHiresList } from './Chauffeurs.jsx';
import {
  MapPinIcon,
  SteeringIcon,
  CalendarIcon,
  StarIcon,
  TrashIcon,
  CheckIcon,
  XIcon,
  UsersIcon,
  SuitcaseIcon,
} from '../icons.jsx';

const PAST = ['completed', 'cancelled', 'rejected'];

export default function Trips() {
  const navigate = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'drivers' ? 'drivers' : 'cars';
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmId, setConfirmId] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const { cars: allCars } = useCars();
  const carById = new Map(allCars.map((c) => [c.id, c]));

  useEffect(() => {
    let on = true;
    listBookings()
      .then((data) => {
        if (on) setBookings((data.bookings || []).map(mapBooking));
      })
      .catch((e) => {
        if (on) setError(e.message || 'Couldn’t load your trips.');
      })
      .finally(() => {
        if (on) setLoading(false);
      });
    return () => {
      on = false;
    };
  }, []);

  // Optimistic: drop the row immediately, restore it if the delete fails.
  const removeTrip = (id) => {
    const prev = bookings;
    setBookings((list) => list.filter((b) => b.id !== id));
    setConfirmId(null);
    deleteBookingRecord(id)
      .then(() => toast.success('Trip removed'))
      .catch((e) => {
        setBookings(prev);
        toast.error(e.message || 'Couldn’t delete this trip.');
      });
  };

  // "You would also love": top-rated cars the renter hasn't booked yet.
  const bookedCarIds = new Set(bookings.map((b) => b.car.id));
  const suggestions = allCars
    .filter((c) => !bookedCarIds.has(c.id))
    .sort((a, b) => (b.rating || 0) - (a.rating || 0))
    .slice(0, 5);

  return (
    <div className="page">
      <div className="container" style={{ maxWidth: 1240 }}>
        <div className="trips-layout">
          <div>
            <div className="nots-tabs trips-tabs" role="tablist">
              <button
                role="tab"
                aria-selected={tab === 'cars'}
                className={`nots-tab${tab === 'cars' ? ' active' : ''}`}
                onClick={() => setParams({}, { replace: true })}
              >
                Cars
              </button>
              <button
                role="tab"
                aria-selected={tab === 'drivers'}
                className={`nots-tab${tab === 'drivers' ? ' active' : ''}`}
                onClick={() => setParams({ tab: 'drivers' }, { replace: true })}
              >
                Drivers
              </button>
            </div>

            {tab === 'drivers' ? (
              <DriverHiresList />
            ) : loading ? (
              <div className="past-panel">
                <div className="past-row" aria-hidden="true">
                  <div className="pic img-skel" style={{ position: 'relative' }} />
                  <div className="past-main">
                    <div className="skel-line" style={{ width: '45%', marginTop: 0 }} />
                    <div className="skel-line" style={{ width: '65%' }} />
                  </div>
                </div>
              </div>
            ) : error ? (
              <div className="empty">{error}</div>
            ) : bookings.length === 0 ? (
              <EmptyState
                variant="compact"
                icon={<SuitcaseIcon size={22} />}
                title="No trips yet"
                message="Your booked trips will show up here, ready to manage."
                action={
                  <Link to="/" className="btn-primary">
                    Browse cars
                  </Link>
                }
              />
            ) : (
              <div className="past-panel">
                {bookings.map((b) => {
                  const isPast = PAST.includes(b.status);
                  const liveCar = carById.get(b.car.id);
                  const rowCar = b.car.photos.length
                    ? b.car
                    : { ...b.car, photos: liveCar?.photos || [] };
                  return (
                    <div
                      className="past-row"
                      key={b.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => navigate(`/trips/${b.id}`)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          navigate(`/trips/${b.id}`);
                        }
                      }}
                    >
                      <CarPhoto car={rowCar} className="pic" />
                      <div className="past-main">
                        <b>{b.car.name}</b>
                        <span>
                          <CalendarIcon size={13} /> {fmtShort(b.pickupDate)} →{' '}
                          {fmtShort(b.dropoffDate)}
                        </span>
                        <span>
                          <MapPinIcon size={13} /> {b.pickupLocation}
                        </span>
                        <span>
                          <SteeringIcon size={13} />{' '}
                          {b.driveType === 'self' ? 'Self drive' : 'With chauffeur'}
                        </span>
                      </div>
                      <div className="past-side">
                        <span className={`status-text ${b.status}`}>{b.status}</span>
                        <b className="past-total">{formatKES(b.total)}</b>
                        <span className="past-days">
                          {b.days} day{b.days === 1 ? '' : 's'} trip
                        </span>
                        {liveCar && (
                          <span className="past-days">
                            <StarIcon size={11} /> {ratingLabel(liveCar)}
                          </span>
                        )}
                        {isPast && (
                          <div className="past-actions" onClick={(e) => e.stopPropagation()}>
                            {confirmId === b.id ? (
                              <>
                                <span className="past-days" style={{ alignSelf: 'center' }}>
                                  Delete?
                                </span>
                                <button
                                  className="icon-btn danger"
                                  aria-label="Confirm delete"
                                  disabled={deleting}
                                  onClick={() => removeTrip(b.id)}
                                >
                                  <CheckIcon size={15} />
                                </button>
                                <button
                                  className="icon-btn"
                                  aria-label="Keep trip"
                                  disabled={deleting}
                                  onClick={() => setConfirmId(null)}
                                >
                                  <XIcon size={15} />
                                </button>
                              </>
                            ) : (
                              <button
                                className="icon-btn danger"
                                aria-label="Delete trip"
                                onClick={() => setConfirmId(b.id)}
                              >
                                <TrashIcon size={15} />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <h2 className="plain-label">You would also love</h2>
            <div className="love-panel">
              {suggestions.length === 0 ? (
                <p className="trips-none" style={{ margin: 0 }}>
                  Loading suggestions…
                </p>
              ) : (
                suggestions.map((car) => (
                  <Link to={`/cars/${car.id}`} className="love-item" key={car.id}>
                    <CarPhoto car={car} className="pic" />
                    <span className="love-text">
                      <b>{car.name}</b>
                      <span className="love-meta">
                        <StarIcon size={11} /> {ratingLabel(car)} · <UsersIcon size={11} />{' '}
                        {car.seats} seats · {car.transmission}
                      </span>
                      <span className="love-meta">
                        <MapPinIcon size={11} /> {car.locationName}
                      </span>
                      <span className="love-price">{formatKES(car.pricePerDay)}/day</span>
                    </span>
                  </Link>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
