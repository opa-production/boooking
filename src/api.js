// Ardena backend API client (contract in API.md).
// JWT auth: bearer access token on every request, rotating refresh token,
// single-flight refresh on 401 followed by one retry.

const BASE = 'https://api.ardena.xyz/api/v1';

// Same Google web client as the client0 app (app.json → extra.googleWebClientId).
export const GOOGLE_WEB_CLIENT_ID =
  '924322385892-r2duge20ikof6atsl1u09oqboagijofn.apps.googleusercontent.com';

const LS_TOKENS = 'ardena.web.tokens';
const LS_CLIENT = 'ardena.web.client';

function load(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function save(key, value) {
  if (value) localStorage.setItem(key, JSON.stringify(value));
  else localStorage.removeItem(key);
}

let tokens = load(LS_TOKENS);
let refreshing = null;

export function hasSession() {
  return Boolean(tokens && tokens.refresh_token);
}

export function loadStoredClient() {
  return load(LS_CLIENT);
}

export function storeClient(client) {
  save(LS_CLIENT, client);
}

export function clearSession() {
  tokens = null;
  save(LS_TOKENS, null);
  save(LS_CLIENT, null);
}

function setTokens(data) {
  tokens = { access_token: data.access_token, refresh_token: data.refresh_token };
  save(LS_TOKENS, tokens);
}

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

/** FastAPI errors: { detail: "message" }, or on 422 a list of field errors
 * plus `message` (the first problem in words). Both are written to be shown as is. */
function errorMessage(data, status) {
  const d = data && data.detail;
  if (typeof d === 'string') return d;
  if (data && typeof data.message === 'string' && data.message) return data.message;
  if (Array.isArray(d) && d.length) {
    const first = d[0];
    const field = Array.isArray(first.loc) ? first.loc[first.loc.length - 1] : null;
    const msg = first.msg || `Request failed (${status})`;
    return field ? `${field}: ${msg}` : msg;
  }
  return `Request failed (${status})`;
}

async function request(path, { method = 'GET', body, auth = false, retry = true } = {}) {
  const headers = {};
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  if (auth) {
    if (!tokens || !tokens.access_token) throw new ApiError('Not signed in', 401, null);
    headers.Authorization = `Bearer ${tokens.access_token}`;
  }

  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers,
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Network error — check your connection and try again.', 0, null);
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }

  if (res.status === 401 && auth && retry) {
    await refreshTokens();
    return request(path, { method, body, auth, retry: false });
  }
  if (!res.ok) throw new ApiError(errorMessage(data, res.status), res.status, data);
  return data;
}

/** Refresh tokens rotate — never run two refreshes in parallel. */
function refreshTokens() {
  if (!refreshing) {
    refreshing = (async () => {
      if (!tokens || !tokens.refresh_token) throw new ApiError('Session expired', 401, null);
      let data;
      try {
        data = await request('/client/auth/refresh', {
          method: 'POST',
          body: { refresh_token: tokens.refresh_token },
        });
      } catch (e) {
        clearSession();
        throw e;
      }
      setTokens(data);
    })().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

// ---------- auth ----------

export async function login(email, password) {
  const data = await request('/client/auth/login', { method: 'POST', body: { email, password } });
  setTokens(data);
  storeClient(data.client);
  return data.client;
}

export async function loginWithGoogle(idToken) {
  const data = await request('/client/auth/google', {
    method: 'POST',
    body: { id_token: idToken },
  });
  setTokens(data);
  storeClient(data.client);
  return data.client;
}

/** Register does not log you in — call login() right after. */
export function register({ fullName, email, password, passwordConfirmation }) {
  return request('/client/auth/register', {
    method: 'POST',
    body: {
      full_name: fullName,
      email,
      password,
      password_confirmation: passwordConfirmation,
    },
  });
}

/** Clears the local session immediately; revokes the refresh token server-side in the background. */
export function logout() {
  const access = tokens && tokens.access_token;
  clearSession();
  if (!access) return Promise.resolve();
  return fetch(BASE + '/client/auth/logout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${access}` },
  }).catch(() => {});
}

export function getMe() {
  return request('/client/me', { auth: true });
}

/** Partial profile update (full_name, mobile_number, date_of_birth, gender, bio, …).
 * Returns the updated client profile. */
export function updateProfile(fields) {
  return request('/client/profile', { method: 'PUT', body: fields, auth: true });
}

// ---------- cars (public, no token needed) ----------

export function listCars(params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, v);
  }
  const query = qs.toString();
  return request('/cars' + (query ? `?${query}` : ''));
}

export function getCar(id) {
  return request(`/cars/${id}`);
}

export function getCarRatings(id) {
  return request(`/cars/${id}/ratings`);
}

export function getCarAvailability(id, startDate, endDate) {
  const qs = new URLSearchParams({ start_date: startDate, end_date: endDate });
  return request(`/cars/${id}/availability?${qs}`);
}

// ---------- wishlist (auth) ----------

export function getWishlist() {
  return request('/client/wishlist?limit=100', { auth: true });
}

export function addToWishlist(carId) {
  return request(`/client/wishlist/${carId}`, { method: 'POST', auth: true });
}

export function removeFromWishlist(carId) {
  return request(`/client/wishlist/${carId}`, { method: 'DELETE', auth: true });
}

// ---------- bookings (auth) ----------

export function createBooking(payload) {
  return request('/client/bookings', { method: 'POST', body: payload, auth: true });
}

export function listBookings() {
  return request('/client/bookings?limit=50', { auth: true });
}

export function getBooking(bookingId) {
  return request(`/client/bookings/${bookingId}`, { auth: true });
}

export function cancelBooking(bookingId) {
  return request(`/client/bookings/${bookingId}/cancel`, { method: 'POST', auth: true });
}

/** Live refund preview if the client cancels right now — does NOT cancel. */
export function getCancellationPreview(bookingId) {
  return request(`/client/bookings/${bookingId}/cancellation-preview`, { auth: true });
}

/** Removes a past booking from the client's history (soft delete server-side). */
export function deleteBookingRecord(bookingId) {
  return request(`/client/bookings/${bookingId}`, { method: 'DELETE', auth: true });
}

// ---------- pay on pickup (auth) ----------

/** Pay the rest of a pay-on-pickup booking: a saved M-Pesa method id, or null for card
 * (Paystack page, back to this website). Poll getPaymentStatus with the returned id. */
export function payBookingBalance(bookingId, paymentMethodId) {
  const body =
    paymentMethodId != null ? { paymentMethodId } : { methodType: 'card', return_to: 'web' };
  return request(`/client/bookings/${bookingId}/balance/pay`, { method: 'POST', body, auth: true });
}

/** Renter paid the host in person. The response is the handover-codes object. */
export function markBalancePaidToHost(bookingId) {
  return request(`/client/bookings/${bookingId}/balance/paid-to-host`, {
    method: 'POST',
    auth: true,
  });
}

/** Something's wrong with the car at pickup: opens a support chat and tells the host. */
export function reportHandoverProblem(bookingId, message) {
  return request(`/client/bookings/${bookingId}/handover-problem`, {
    method: 'POST',
    body: { message },
    auth: true,
  });
}

/** Renter's pickup/return handover codes for a booking. */
export function getHandoverCodes(bookingId) {
  return request(`/client/bookings/${bookingId}/handover`, { auth: true });
}

/** Regenerate one handover code (phase: 'pickup' | 'return'); old code stops working. */
export function refreshHandoverCode(bookingId, phase) {
  return request(`/client/bookings/${bookingId}/handover/${phase}/refresh`, {
    method: 'POST',
    auth: true,
  });
}

// ---------- trip extensions (auth) ----------
// Client proposes a later drop-off → host approves → client pays the extra days
// (M-Pesa only, at least 24h before the current drop-off).

export function listExtensions(bookingId) {
  return request(`/client/bookings/${bookingId}/extensions`, { auth: true });
}

export function requestExtension(bookingId, newEndDate, newDropoffLocation = null) {
  return request(`/client/bookings/${bookingId}/extensions`, {
    method: 'POST',
    body: {
      new_end_date: newEndDate,
      dropoff_same_as_previous: !newDropoffLocation,
      new_dropoff_location: newDropoffLocation || null,
    },
    auth: true,
  });
}

/** STK push for a host-approved extension. Poll getPaymentStatus({ checkout_request_id }). */
export function payExtension(bookingId, extensionId, paymentMethodId) {
  return request(`/client/bookings/${bookingId}/extensions/${extensionId}/pay`, {
    method: 'POST',
    body: { payment_method_id: paymentMethodId },
    auth: true,
  });
}

async function requestBlob(path, retry = true) {
  if (!tokens || !tokens.access_token) throw new ApiError('Not signed in', 401, null);
  let res;
  try {
    res = await fetch(BASE + path, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
  } catch {
    throw new ApiError('Network error — check your connection and try again.', 0, null);
  }
  if (res.status === 401 && retry) {
    await refreshTokens();
    return requestBlob(path, false);
  }
  if (!res.ok) {
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* not json */
    }
    throw new ApiError(errorMessage(data, res.status), res.status, data);
  }
  return res.blob();
}

/** Downloads the booking's PDF receipt via the browser's save dialog. */
export async function downloadReceipt(bookingId) {
  const blob = await requestBlob(`/client/bookings/${bookingId}/receipt`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `receipt-${bookingId}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Report a listing for moderation. One open report per client per car (429 on repeat). */
export function reportListing(carId, reason, details) {
  return request(`/client/cars/${carId}/report`, {
    method: 'POST',
    body: { reason, details },
    auth: true,
  });
}

// ---------- notifications (auth) ----------

export function getNotifications() {
  return request('/client/notifications', { auth: true });
}

export function markNotificationRead(id) {
  return request(`/client/notifications/${id}/read`, { method: 'PUT', auth: true });
}

/** Both toggles return the updated client profile. */
export function setEmailNotifications(enabled) {
  return request('/client/notifications/email', { method: 'POST', body: { enabled }, auth: true });
}

export function setInAppNotifications(enabled) {
  return request('/client/notifications/in-app', { method: 'POST', body: { enabled }, auth: true });
}

// ---------- identity / driver's licence verification (Dojah KYC, auth) ----------

/** Step 1 (optional): government ID lookup — verifies the ID and prefills the profile. */
export function kycLookup(idType, idNumber, country = 'KE') {
  return request('/client/kyc/lookup', {
    method: 'POST',
    body: { id_type: idType, id_number: idNumber, country },
    auth: true,
  });
}

/** Step 2: create a verification session; returns Dojah widget credentials. */
export function initializeKyc() {
  return request('/client/kyc/initialize', { method: 'POST', auth: true });
}

/** Step 3: poll after the widget completes (webhook updates it asynchronously). */
export function getKycStatus() {
  return request('/client/kyc/status', { auth: true });
}

/** Same hosted-widget URL the app opens (document scan + liveness + face match). */
export function buildDojahUrl(creds) {
  const params = new URLSearchParams({
    app_id: creds.app_id,
    p_key: creds.p_key,
    type: 'custom',
    widget_id: creds.widget_id,
    reference_id: creds.reference_id,
  });
  return `https://identity.dojah.io/?${params}`;
}

// ---------- messages (auth) ----------
// One continuous conversation per client-host pair, same threads as the app.

export function getConversations() {
  return request('/client/messages', { auth: true });
}

/** Also marks the host's messages as read server-side. */
export function getConversationWithHost(hostId) {
  return request(`/client/messages/host/${hostId}`, { auth: true });
}

export function sendMessageToHost(hostId, message) {
  return request(`/client/messages/host/${hostId}`, {
    method: 'POST',
    body: { message },
    auth: true,
  });
}

// ---------- customer support chat (auth) ----------

export function getSupportConversation() {
  return request('/client/support/conversation', { auth: true });
}

export function sendSupportMessage(message) {
  return request('/client/support/messages', { method: 'POST', body: { message }, auth: true });
}

// ---------- payment methods + payments (auth) ----------

export function listPaymentMethods() {
  return request('/client/payment-methods', { auth: true });
}

export function addMpesaMethod(name, mpesaNumber, isDefault = false) {
  return request('/client/payment-methods/mpesa', {
    method: 'POST',
    body: { name, mpesa_number: mpesaNumber, is_default: isDefault },
    auth: true,
  });
}

export function deletePaymentMethod(id) {
  return request(`/client/payment-methods/${id}`, { method: 'DELETE', auth: true });
}

export function setDefaultPaymentMethod(id) {
  return request(`/client/payment-methods/${id}/default`, { method: 'PUT', auth: true });
}

/**
 * M-Pesa STK (a saved M-Pesa method id) or Paystack card (no id: Paystack
 * collects the card on its own page, so nothing is saved on our side).
 * Card responses include redirect_url.
 */
export function processPayment(bookingId, paymentMethodId) {
  // return_to: Paystack sends the payer back to /payment/result on this site, not the app.
  const body = paymentMethodId != null
    ? { booking_id: bookingId, payment_method_id: paymentMethodId }
    : { booking_id: bookingId, method_type: 'card', return_to: 'web' };
  return request('/client/payments/process', { method: 'POST', body, auth: true });
}

/** Poll with one of: { checkout_request_id } | { paystack_reference } | { booking_id }. */
export function getPaymentStatus(params) {
  return request('/client/payments/status?' + new URLSearchParams(params), { auth: true });
}

// ---------- avatar fallback (public, no token) ----------
// Profiles and listings don't always carry avatar_url; the backend looks the
// file up in storage (and saves it back), the same lookups the apps use.

async function avatarLookup(path) {
  try {
    const data = await request(path);
    return (data && data.avatar_url) || null;
  } catch {
    return null;
  }
}

export function findHostAvatar(hostId) {
  return avatarLookup(`/hosts/${hostId}/avatar-lookup`);
}

export function findClientAvatar(clientId) {
  return avatarLookup(`/client/${clientId}/avatar-lookup`);
}

// ---------- driving licence on the profile (auth) ----------

/** 404 when no licence is on file. */
export function getDrivingLicense() {
  return request('/client/driving-license', { auth: true });
}

/** { license_number, category, issue_date, expiry_date }. Editing resets is_verified. */
export function saveDrivingLicense(fields, exists) {
  return request('/client/driving-license', {
    method: exists ? 'PUT' : 'POST',
    body: fields,
    auth: true,
  });
}

// ---------- Ardena Chauffeurs: hiring a driver (auth) ----------

export function searchChauffeurs(params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, v);
  }
  const query = qs.toString();
  return request('/chauffeurs' + (query ? `?${query}` : ''), { auth: true });
}

export function getChauffeur(id) {
  return request(`/chauffeurs/${encodeURIComponent(id)}`, { auth: true });
}

export function getChauffeurReviews(id, page = 1) {
  return request(`/chauffeurs/${encodeURIComponent(id)}/reviews?page=${page}`, { auth: true });
}

/** The server prices the hire; show the response's `total`. A 409 detail says why not. */
export function createChauffeurHire(payload) {
  return request('/chauffeur-bookings', { method: 'POST', body: payload, auth: true });
}

export function listChauffeurHires() {
  return request('/me/chauffeur-bookings', { auth: true });
}

export function getChauffeurHire(id) {
  return request(`/me/chauffeur-bookings/${encodeURIComponent(id)}`, { auth: true });
}

/** M-Pesa with a saved method id, or card (null id) back to this website. */
export function payChauffeurHire(id, paymentMethodId) {
  const body =
    paymentMethodId != null
      ? { method: 'mpesa', payment_method_id: paymentMethodId }
      : { method: 'card', return_to: 'web' };
  return request(`/me/chauffeur-bookings/${encodeURIComponent(id)}/pay`, {
    method: 'POST',
    body,
    auth: true,
  });
}

export function cancelChauffeurHire(id, reason) {
  return request(`/me/chauffeur-bookings/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
    body: { reason: reason || null },
    auth: true,
  });
}

export function reviewChauffeurHire(id, rating, text) {
  return request(`/me/chauffeur-bookings/${encodeURIComponent(id)}/review`, {
    method: 'POST',
    body: { rating, text: text || null },
    auth: true,
  });
}

export function getChauffeurThreads() {
  return request('/chauffeur-threads?role=client', { auth: true });
}

export function getChauffeurMessages(hireId) {
  return request(`/chauffeur-bookings/${encodeURIComponent(hireId)}/messages`, { auth: true });
}

export function sendChauffeurMessage(hireId, text) {
  return request(`/chauffeur-bookings/${encodeURIComponent(hireId)}/messages`, {
    method: 'POST',
    body: { text },
    auth: true,
  });
}

// ---------- Ardena Chauffeurs: applying to drive (auth) ----------

/** 404 = hasn't applied yet. */
export function getChauffeurApplication() {
  return request('/chauffeur/application', { auth: true });
}

export function getChauffeurPrefill() {
  return request('/chauffeur/application/prefill', { auth: true });
}

/** One photo per call. kind: photo | licence_photo | id_photo | good_conduct_photo.
 * Returns { id, url, kind }; send `url` back unchanged in the application. */
export function uploadChauffeurDocument(file, kind) {
  const form = new FormData();
  form.append('file', file, file.name || `${kind}.jpg`);
  form.append('kind', kind);
  return request('/chauffeur/documents', { method: 'POST', body: form, auth: true });
}

/** Re-submitting replaces the previous application. */
export function submitChauffeurApplication(payload) {
  return request('/chauffeur/application', { method: 'POST', body: payload, auth: true });
}

// Password reset — 3-step OTP flow (6 digits, 5-minute expiry).
export function forgotPassword(email) {
  return request('/client/auth/forgot-password', { method: 'POST', body: { email } });
}

export function verifyResetOtp(email, otp) {
  return request('/client/auth/verify-reset-otp', { method: 'POST', body: { email, otp } });
}

export function resetPassword(email, otp, newPassword) {
  return request('/client/auth/reset-password', {
    method: 'POST',
    body: { email, otp, new_password: newPassword },
  });
}
