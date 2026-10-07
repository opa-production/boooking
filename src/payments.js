// Shared payment plumbing for car bookings, pay-on-pickup balances and driver
// hires: they all ride the same rails (M-Pesa STK or a Paystack card page) and
// are confirmed by polling GET /client/payments/status.
import * as api from './api.js';

export const POLL_INTERVAL_MS = 3500;
export const MPESA_POLL_TRIES = 40; // ~2.3 minutes
export const CARD_POLL_TRIES = 120; // ~7 minutes (the payer is on Paystack's page)

// The /payment/result page posts this to the tab that opened Paystack.
export const PAYMENT_RETURN_MESSAGE = 'ardena:payment-return';

export function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.startsWith('254')) return digits;
  if (digits.startsWith('0')) return '254' + digits.slice(1);
  return '254' + digits;
}

function methodList(data) {
  const methods = data?.payment_methods || data?.methods || data || [];
  return Array.isArray(methods) ? methods : [];
}

/** The saved M-Pesa method for this number, created when there isn't one. */
export async function ensureMpesaMethod(phone) {
  const number = normalizePhone(phone);
  if (number.length < 12) throw new Error('Enter a valid M-Pesa number.');
  const existing = methodList(await api.listPaymentMethods().catch(() => null));
  const match = existing.find(
    (m) => m.method_type === 'mpesa' && normalizePhone(m.mpesa_number) === number
  );
  if (match) return match.id;
  return (await api.addMpesaMethod('M-Pesa', number)).id;
}

/** The client's default (or first) saved M-Pesa number, for prefilling. */
export async function defaultMpesaNumber() {
  const mpesa = methodList(await api.listPaymentMethods().catch(() => null)).filter(
    (m) => m.method_type === 'mpesa'
  );
  return (mpesa.find((m) => m.is_default) || mpesa[0])?.mpesa_number || '';
}

/**
 * Polls until the payment completes or fails. Resolves with the final status
 * object, or { status: 'timeout' }, or null when isCancelled() turns true.
 * `wake` lets the caller cut the current wait short (the payer came back).
 */
export async function pollPayment(params, { tries, isCancelled = () => false, wake } = {}) {
  for (let i = 0; i < tries; i++) {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, POLL_INTERVAL_MS);
      if (wake) {
        wake.current = () => {
          clearTimeout(timer);
          resolve();
        };
      }
    });
    if (isCancelled()) return null;
    let status;
    try {
      status = await api.getPaymentStatus(params);
    } catch {
      continue; // transient, keep polling
    }
    if (isCancelled()) return null;
    if (['completed', 'failed', 'cancelled'].includes(status.status)) return status;
  }
  return { status: 'timeout' };
}

/** Opens Paystack in a new tab; if the browser blocks it, goes there in this one.
 * Returns false when this tab is navigating away. No `noopener`: the result page
 * uses window.opener to hand control back to this tab. */
export function openPaystack(url) {
  const tab = window.open(url, '_blank');
  if (tab) return true;
  window.location.href = url;
  return false;
}

/** Calls back when the Paystack tab reports it's done. Returns an unsubscribe. */
export function onPaymentReturn(callback) {
  const handler = (e) => {
    if (e.origin !== window.location.origin) return;
    if (e.data && e.data.type === PAYMENT_RETURN_MESSAGE) callback(e.data.reference);
  };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}

/** Where a paid item lives on this site: driver hires are chb_…, car bookings the rest. */
export function paidItemPath(bookingId) {
  if (!bookingId) return '/trips';
  return String(bookingId).startsWith('chb_') ? `/driver-hires/${bookingId}` : `/trips/${bookingId}`;
}
