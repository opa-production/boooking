# Ardena Bookings Web

The customer-facing web portal for [Ardena](https://ardena.co.ke), Kenya's car-rental
marketplace — built so renters can browse, book, pay and chat end-to-end from the
browser, with the **same account and data as the Ardena mobile app**.

Target domain: **bookings.ardena.co.ke**

## What it does

| Area | Status | Backed by |
| --- | --- | --- |
| Browse cars, search by city | Live | `GET /cars` |
| Car details, photos, reviews | Live | `GET /cars/{id}`, `/ratings` |
| Availability calendar (booked dates greyed out) | Live | `GET /cars/{id}/availability` |
| Auth: email/password, Google, 3-step OTP reset | Live | `POST /client/auth/*` |
| Booking flow (dates, drive type, protection, check-in) | Live | `POST /client/bookings` |
| Payments: M-Pesa STK push + Paystack card | Live | `POST /client/payments/process` |
| My trips, trip details, cancel with refund preview | Live | `GET /client/bookings*` |
| PDF receipt download | Live | `GET /client/bookings/{id}/receipt` |
| Handover pickup/return codes | Live | `GET /client/bookings/{id}/handover` |
| Wishlist (synced hearts) | Live | `/client/wishlist*` |
| Client ↔ host chat (syncs with the app) | Live | `/client/messages*` |
| Payment methods (list / add M-Pesa / default) | Live | `/client/payment-methods*` |
| Report a listing | Live | `POST /client/cars/{id}/report` |
| Driver's licence / identity verification (Dojah) | Live | `/client/kyc/*` |
| Notifications | Mock | — |

## Stack

- **React 18 + Vite** — no UI framework, hand-rolled neomorphic design system
  (`src/index.css`), Nunito font, brand blue `#007ffa`, custom SVG icon set (no emojis).
- **react-router-dom** with hash routing (`/#/cars/33`), so it deploys as a static
  bundle with zero server config.
- **No state library** — one context (`src/store.jsx`) for auth + wishlist; pages
  fetch what they need through small cached hooks (`src/cars.js`).

## Getting started

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production bundle in dist/
```

The app talks to the production backend at `https://api.ardena.xyz/api/v1`
(see `src/api.js`). Public pages work signed out; log in with any Ardena
account — accounts are shared with the mobile app.

## Project layout

```
src/
  api.js          All backend calls: JWT auth (rotating refresh, single-flight),
                  cars, bookings, payments, wishlist, messages, KYC, receipts
  cars.js         API → UI mapping + cached data hooks (useCars, useCar, ratings)
  store.jsx       Auth session, profile (with Supabase avatar fallback), wishlist
  data.js         Constants and date/price helpers only — no mock data
  components.jsx  Header, footer (mirrors ardena.co.ke), cards, avatars, skeletons
  Calendar.jsx    Two-month date-range picker with disabled/unavailable dates
  pages/          One file per route (Home, CarDetails, Booking, Payment, Trips,
                  TripDetails, Messages, Wishlist, Payments, Account, Login, …)
API.md            Backend API contract used by this site
```

## Design language

- **Dashed border** = the user needs to act (form fields, pay methods, choice
  buttons). Selected/focused switches to a solid blue border.
- **Sunken (inset) surface** = information display (price breakdowns, readonly
  fields, status pills, notices).
- Auth, account and checkout routes hide the footer to stay focused.

## One-time external config

- **Google sign-in**: add `http://localhost:5173` and the production domain to the
  OAuth web client's *Authorized JavaScript origins* in Google Cloud Console
  (same client ID the mobile apps use — see `GOOGLE_WEB_CLIENT_ID` in `src/api.js`).
- **CORS**: the backend must allow the deployed origin (localhost already works).

## Deploying

`npm run build` produces a static `dist/` — host it anywhere (Vercel, Netlify,
nginx). Hash routing means no rewrite rules are needed for the site itself.

### Car share links (Vercel)

The Ardena app shares cars as `https://booking.ardena.co.ke/cars/:id` (a real
path, not `/#/…`, because nothing after `#` reaches a server). `vercel.json`
rewrites that path to the function in `api/car.js`, which:

- redirects people to `/#/cars/:id`;
- gives link-preview crawlers (WhatsApp, iMessage, Telegram, …) that car's
  Open Graph tags, so the chat shows its photo, name and price.

Check it with `curl -A "WhatsApp/2.23" https://booking.ardena.co.ke/cars/<id>`
(should print `og:` tags) or the Facebook Sharing Debugger. If Cloudflare's bot
protection is on for the domain, allow these crawlers through.
