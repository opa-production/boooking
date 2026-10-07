import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { formatKES, formatDateLong } from '../data.js';
import { mapBooking } from '../cars.js';
import { CarPhoto, BookingSteps } from '../components.jsx';
import { getBooking } from '../api.js';
import { CheckIcon } from '../icons.jsx';

export default function Confirmation() {
  const { id } = useParams();
  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let on = true;
    setLoading(true);
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

  if (loading) {
    return (
      <div className="page container">
        <div className="empty">Loading your booking…</div>
      </div>
    );
  }

  if (!booking) {
    return (
      <div className="page container">
        <div className="empty">
          Booking not found. <Link to="/trips">View my trips</Link>
        </div>
      </div>
    );
  }

  const car = booking.car;

  return (
    <div className="page">
      <div className="container" style={{ maxWidth: 640 }}>
        <BookingSteps current={3} />
        <div className="confirm-hero">
          <div className="confirm-tick">
            <CheckIcon size={38} />
          </div>
          <h1 className="page-title">You&apos;re booked!</h1>
          <p className="page-sub">
            We&apos;ve sent the details to your email. Your booking also appears in the Ardena app —
            same account, same trip.
          </p>
          <div className="booking-code">{booking.id}</div>
        </div>

        <div className="form-card" style={{ marginTop: 30 }}>
          <div className="mini-car">
            <CarPhoto car={car} className="pic" />
            <div>
              <b>{car.name}</b>
              <div className="car-meta">
                Hosted by {car.host.name} ·{' '}
                {booking.driveType === 'self' ? 'Self drive' : 'With chauffeur'}
              </div>
            </div>
          </div>

          <div className="breakdown">
            <div className="row">
              <span>Pickup</span>
              <span>
                {formatDateLong(booking.pickupDate)} · {booking.pickupTime}
              </span>
            </div>
            <div className="row">
              <span>Drop-off</span>
              <span>
                {formatDateLong(booking.dropoffDate)} · {booking.dropoffTime}
              </span>
            </div>
            {booking.delivery ? (
              <div className="row">
                <span>Delivered to &amp; collected from</span>
                <span>{booking.delivery.address}</span>
              </div>
            ) : (
              <>
                <div className="row">
                  <span>Pickup point</span>
                  <span>{booking.pickupLocation}</span>
                </div>
                <div className="row">
                  <span>Return point</span>
                  <span>{booking.dropoffLocation}</span>
                </div>
              </>
            )}
            {booking.deposit > 0 && (
              <div className="row">
                <span>Refundable deposit</span>
                <span>{formatKES(booking.deposit)}</span>
              </div>
            )}
            {booking.payOnPickup ? (
              <>
                <div className="row total">
                  <span>Paid now</span>
                  <span>{formatKES(booking.payOnPickup.upfront_amount)}</span>
                </div>
                <div className="row">
                  <span>To pay at pickup</span>
                  <span>{formatKES(booking.payOnPickup.balance_amount)}</span>
                </div>
              </>
            ) : (
              <div className="row total">
                <span>Paid</span>
                <span>{formatKES(booking.total)}</span>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 14, marginTop: 'var(--sp-5)', flexWrap: 'wrap' }}>
            <Link to="/trips" className="btn-primary" style={{ flex: 1, textAlign: 'center' }}>
              View my trips
            </Link>
            <Link to="/" className="btn-secondary" style={{ flex: 1, textAlign: 'center', padding: '14px 22px' }}>
              Book another car
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
