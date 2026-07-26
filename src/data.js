// Shared constants and date/price helpers for booking.ardena.co.ke.
// All data (cars, auth, wishlist, bookings, payments, messages) comes from
// api.ardena.xyz — see src/api.js and src/cars.js. Notifications are still mock.

export const DAMAGE_WAIVER_PRICE_PER_DAY = 250;
export const MIN_RENTAL_DAYS = 3; // search-widget default only; real minimum is per car

export const NAKURU_LOCATIONS = [
  { id: 1, name: 'Golden Life Mall', address: 'Kolen, opposite Shell, Nakuru' },
  { id: 2, name: 'Nakuru CBD', address: 'Kenyatta Avenue, Nakuru Town' },
  { id: 3, name: 'Westside Mall', address: 'Nakuru-Naivasha Road, Nakuru' },
  { id: 4, name: 'Nakuru Railway Station', address: 'Station Road, Nakuru' },
  { id: 5, name: 'Kenyatta Avenue', address: 'Kenyatta Avenue, Nakuru CBD' },
  { id: 6, name: 'Lanet', address: 'Lanet, Nakuru' },
  { id: 7, name: 'Section 58 (Ngata)', address: 'Section 58, Ngata, Nakuru' },
  { id: 8, name: 'Mburu Gichua Road', address: 'Mburu Gichua Road, Nakuru' },
  { id: 9, name: 'Kaptembwo', address: 'Kaptembwo, Nakuru' },
  { id: 10, name: 'Wakulima Market', address: 'Wakulima Market area, Nakuru' },
];

export const CITIES = ['All cities', 'Nakuru', 'Nairobi', 'Mombasa', 'Kisumu', 'Eldoret'];

export function formatKES(amount) {
  return `KES ${Number(amount).toLocaleString('en-KE')}`;
}

export function daysBetween(startDate, endDate) {
  const ms = new Date(endDate) - new Date(startDate);
  return Math.max(0, Math.round(ms / 86400000));
}

export function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export function formatDateLong(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-KE', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function newBookingCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return `ARD-${code}`;
}
