# booking.ardena.co.ke: catching up with the API

For the agents working on the booking website (`Desktop/booking`, React + Vite, API client in
`src/api.js`). The app has gained several features the website doesn't have yet. This is everything
the website needs to match it, plus taking **chauffeur applications on the web, from people who
don't have an account yet**.

- **Base URL:** `https://api.ardena.xyz/api/v1`. CORS already allows `https://*.ardena.co.ke`.
- **Errors:** `{ "detail": "…" }`, written to be shown as is. A 422 also has `message` (the first
  problem in words). Show `message` when `detail` isn't a string.
- **Never calculate money on the client.** Every amount below comes from the API.

Deeper detail lives in the backend repo: `CHAUFFEURS_HANDOFF.md` (hiring drivers),
`CHAUFFEURS_LOCATION_LICENCE_UI.md` (licence badge, driver location) and `PAY_ON_PICKUP_HANDOFF.md`.
This guide is enough to build from.

Suggested order: **§1 fixes → §2 delivery → §3 pay on pickup → §6 become a chauffeur → §5 hire a
driver.**

---

## 1. Fixes first

### 1.1 Stop reading Supabase directly (`src/api.js`)

`findHostAvatar` / `findClientAvatar` list files in Supabase project `mvzddrdfkgydoitrblpq` with an
anon key. The backend now stores files in a different project, so these miss new avatars. They
also rely on the bucket allowing anonymous listing, which we're closing. Replace both with the
backend lookups the apps use (public, no token):

```
GET /client/{client_id}/avatar-lookup   →  { "avatar_url": "https://…" | null }
GET /hosts/{host_id}/avatar-lookup      →  { "avatar_url": "https://…" | null }
```

Then delete `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `AVATAR_BUCKET` from the website.

### 1.2 Card payments come back to the website

Today Paystack sends the payer to the **app's** deep link after paying ("Opening app…"). Add
`"return_to": "web"` (or `returnTo`) to every card payment request:

- `POST /client/payments/process` → `{ "booking_id", "method_type": "card", "return_to": "web" }`
- `POST /client/bookings/{id}/balance/pay` → `{ "methodType": "card", "return_to": "web" }`
- `POST /me/chauffeur-bookings/{id}/pay` → `{ "method": "card", "return_to": "web" }`

Paystack then redirects to **`https://booking.ardena.co.ke/payment/result?reference=<ref>`**. Add
that route (public, no `RequireAuth` needed to render):

- If this tab opened Paystack, use `window.opener`: post a message to the opener and close.
- Otherwise poll `GET /client/payments/status?paystack_reference=<ref>` (needs the session) and show
  "Payment received" or the failure `message`, with a link to the trip.

The website keeps polling in the original tab as it does today. Nothing changes there.

> Ops: if the site's real domain isn't `booking.ardena.co.ke`, set `WEB_BOOKING_URL` on the API
> server (e.g. `https://bookings.ardena.co.ke`).

### 1.3 Show the right amount on the pay page (`src/pages/Payment.jsx`)

The pay button uses `booking.total_price`. Use **`booking.amount_due_now`** instead (falls back to
`total_price`). It's what the payment actually charges: the full total, or only the upfront part on
pay on pickup (§3). `amount_paid` in the process response says the same.

---

## 2. Delivery

### Car page and listing

`GET /cars` and `GET /cars/{id}` include:

```json
"delivery_available": true,
"delivery_cities": [
  { "city": "Nairobi", "fee": 1500.0, "free": false },
  { "city": "Nakuru",  "fee": 0.0,    "free": true }
]
```

- **Card:** a "Delivery" badge when `delivery_available` ("Free delivery" if every city is `free`).
- **Car page:** a Delivery row listing each city and fee, plus "Delivered to you and collected from
  the same address."
- **Filter:** `GET /cars?delivers_to=Nairobi` (case-insensitive) for a "Delivered to me" toggle.
- Map `delivery_available`, `delivery_cities` and `pay_on_pickup_available` in `mapCar`
  (`src/cars.js`).

### Checkout (`src/pages/Booking.jsx` → `Payment.jsx`)

Add **Pickup / Delivery** (Delivery only when `delivery_available`). For Delivery:

1. **City:** limited to the car's `delivery_cities`.
2. **Address:** typed, and/or **"Use my current location"** with `navigator.geolocation` (ask only
   on tap). The server turns coordinates into an address. Send a typed note as well ("Gate B").
3. **Breakdown:** "Delivery & collection: KES 1,500" (or "Free"), from the chosen city.

`POST /client/bookings` takes:

```json
{
  "car_id": 12,
  "start_date": "2030-01-01T10:00:00",
  "end_date": "2030-01-04T10:00:00",
  "drive_type": "self",
  "delivery": {
    "city": "Nairobi",
    "address": "Sarit Centre, Westlands",
    "latitude": -1.268,
    "longitude": 36.811,
    "source": "current_location"
  }
}
```

- With `delivery`, **leave out** `pickup_location` / `return_location`. The server uses the address
  for both, and the host collects from the same place.
- Coordinates: send both or neither. `source` is `typed` or `current_location`.
- Errors (400, shown as is): the car has no delivery; the city isn't offered; the pin is over 50 km
  from the city.

### The trip page (`src/pages/TripDetails.jsx`)

Bookings carry `delivery_fee` and `delivery: { city, address, latitude, longitude, fee,
collection_included } | null`.

- When `delivery` is set, show "Delivered to …" and "Collected from …" (same address) instead of
  the pickup/return locations, with a map pin when there are coordinates.
- The cancel preview's `refund_policy_reason` already explains the delivery-fee rule (refunded up to
  3 hours before delivery). Show it as is.

---

## 3. Pay on pickup

A host can let renters **pay Ardena's fee (+ deposit, + delivery fee) now and the rest at pickup**.
This works on any car, collected or delivered.

### Car page and checkout

- `pay_on_pickup_available: true` → a "Pay on pickup" badge, and a **Pay now / Pay on pickup**
  choice at checkout.
- Send `"payment_mode": "pay_on_pickup"` on `POST /client/bookings` (default `"full"`).
- Errors (400): "The host doesn't offer pay on pickup for this car. Choose to pay now." / "This
  booking is too small to split. Choose to pay now."
- **Breakdown from the created booking:**
  - "Pay now: KES `pay_on_pickup.upfront_amount`"
  - "Pay at pickup: KES `pay_on_pickup.balance_amount`"
- Then pay as usual (`/client/payments/process`). It charges `amount_due_now` (the upfront part)
  automatically (§1.3).

### On the trip page

When `payment_mode == "pay_on_pickup"`, bookings carry:

```json
"pay_on_pickup": {
  "upfront_amount": 1350, "balance_amount": 13650,
  "balance_status": "pending",
  "can_pay_balance_in_app": true,
  "no_show_allowed_from": "…", "problem_reported": false
}
```

While `balance_status == "pending"`:
- Show **"KES 13,650 to pay at pickup"**.
- `GET /client/bookings/{id}/handover` gives `pickup.state = "awaiting_balance"` and **no code**.
  Show "Your pickup code appears once the balance is paid."

When the renter is with the car, offer three actions:

| Action | Call | Then |
|---|---|---|
| **Pay the rest here** (only if `can_pay_balance_in_app`) | `POST /client/bookings/{id}/balance/pay` `{ "paymentMethodId": 12 }` or `{ "methodType": "card", "return_to": "web" }` | Poll `GET /client/payments/status?checkout_request_id=…` (or `paystack_reference`) until `completed`, then reload the handover codes |
| **I've received the car and paid the host** | `POST /client/bookings/{id}/balance/paid-to-host` | Confirm first ("Only tap this once you've paid the host KES 13,650"). The response **is** the handover-codes object, so show the code at once |
| **Problem with the car** | `POST /client/bookings/{id}/handover-problem` `{ "message": "…" }` | Opens a support chat and tells the host. Don't pay |

Once `balance_status == "paid_to_host"`, **hide Cancel** (the API refuses it with 409; it's
support's job then).

---

## 4. Driving licence badge (`/license` page)

`GET /client/driving-license` returns `is_verified` and `expiry_date`. Show:

| State | Badge |
|---|---|
| No licence | "Add licence" |
| `is_verified` false | grey "Not verified yet" |
| `is_verified` true and `expiry_date` not past | green **"Verified"** |
| `expiry_date` in the past | red "Expired, update it" |

Before saving an edit to a verified licence, warn: "Changing your licence removes its Verified badge
until Ardena checks it again." (The API resets it.)

---

## 5. Hire a driver (Ardena Chauffeurs)

Same API as the app. Full contract: `drivers.md` + `CHAUFFEURS_HANDOFF.md` in the backend repo.

| Screen | Calls |
|---|---|
| **Find a driver** (`/chauffeurs`) | `GET /chauffeurs?town=Nakuru` or `?lat=&lng=` (Near me, from `navigator.geolocation`), optional `start`, `end` (URL-encode the `+03:00`), `vehicle_type`. Needs login. |
| **Driver profile** (`/chauffeurs/:id`) | `GET /chauffeurs/:id` (has `bio`, `reviews`), more with `GET /chauffeurs/:id/reviews?page=` |
| **Hire** | `POST /chauffeur-bookings` (mode `days`/`hours`, start, pickup, `car_source` `own`/`ardena`, `payment_method` `pay_now`/`cash`). The server prices it; show the response's `total`. A 409 `detail` says why a driver can't take it. |
| **Pay** | `POST /me/chauffeur-bookings/:id/pay` `{ method: "mpesa", payment_method_id }` or `{ method: "card", return_to: "web" }`; poll `GET /client/payments/status` as for cars |
| **My driver hires** (add a "Drivers" tab to Trips) | `GET /me/chauffeur-bookings`; one with `GET /me/chauffeur-bookings/:id` |
| **Cancel / rate** | `POST /me/chauffeur-bookings/:id/cancel` `{ reason }`, `POST …/review` `{ rating, text }` |
| **Chat with the driver** (in Messages) | `GET /chauffeur-threads?role=client`, `GET`/`POST /chauffeur-bookings/:id/messages` |

**Map pins:** each driver has `location: { lat, lng, source } | null`.
- `live`: a pin.
- `base`: a soft ~2 km circle, "Usually around here".
- `null`: no pin.

**Driver plus an Ardena car, without a licence:** the renter hires the driver **first**
(`car_source: "ardena"`, no `car_booking_id`), then books the car with
`"chauffeur_booking_id": "chb_…"` in `POST /client/bookings`. That car booking is chauffeur-driven,
so no renter licence is needed. Booking the car first keeps the normal licence check.

---

## 6. Become a chauffeur, including guests

A **public** page, e.g. `/drive` ("Drive with Ardena"), linked from the home page and the account
menu. **No account needed to start.**

### Step 0: an account, made as part of applying

Approved drivers work from the Ardena app's **Chauffeur Mode** with this account, so applying creates
one. Nothing extra is needed from the backend.

- **Already signed in:** skip to step 1.
- **Guest:** show a short "Create your account" panel *inside the application*. It's the first step
  of the form, not a redirect to `/signup`:
  1. Full name, email, password (+ confirm), or **Continue with Google** (`/client/auth/google`,
     same as `Login.jsx`).
  2. `POST /client/auth/register` `{ full_name, email, password, password_confirmation }`, then
     `POST /client/auth/login`, and store the tokens as the login page does.
  3. **Email already registered** (register returns 400 "Email already registered"): "You already have an Ardena account. Log
     in to continue" with an inline login form, then carry on. **Keep everything typed so far.**
- Keep the in-progress application in `sessionStorage` (form fields only, never files or tokens),
  so a reload or the login detour loses nothing.

### Step 1: prefill

`GET /chauffeur/application/prefill` →
`{ first_name, last_name, phone, photo_url, licence: { on_file, verified, expired, licence_number, category, expiry_date } }`.

- Prefill name, phone and photo.
- **If `licence.verified`:** replace the licence step with a read-only card ("•••• 4321 · B1 · Valid
  until 1 Jan 2030") and a green **Verified** badge. Send **no** `licence_number` / `licence_photo`.
- First check `GET /chauffeur/application`: a 404 means they haven't applied. If it returns an
  application, show its status page instead (step 4).

### Step 2: uploads

`POST /chauffeur/documents` (multipart: `file`, `kind`), one call per file. `kind` is `photo`,
`licence_photo`, `id_photo` or `good_conduct_photo` (optional).

- JPEG, PNG or WebP, up to 10 MB. Use `<input type="file" accept="image/*" capture="environment">`
  so phones open the camera.
- The response is `{ id, url, kind }`. Keep `url` and send it back unchanged. Licence and ID links
  are private and expire after an hour; that's fine.
- Show each thumbnail from the local file (`URL.createObjectURL`), not from `url`.

### Step 3: the form, then submit

Fields as in the app (all in `POST /chauffeur/application`):

- **Who:** `first_name`, `last_name`, `phone` (Kenyan mobile), `years_experience`, `languages[]`,
  `bio`.
- **Licence:** `licence_number`, plus `licence_photo` / `id_photo` / `good_conduct_photo` as
  `{ url, name }`.
- **Where:** `base_town`, `areas_served[]`, `nationwide`, and **"Use my current location"** →
  `base_lat`, `base_lng` (both or neither; `navigator.geolocation`, with a draggable map pin to
  correct it). Explain: "We only show renters your area, never the exact spot."
- **Cars:** `car_types[]` from `Saloon`, `SUV`, `Pickup`, `Van / Minibus`, `Luxury`, `Electric`;
  `transmissions[]` (`Automatic`/`Manual`); `service_type` (`driver_only`/`car_and_driver`).
- **When:** `days[]` (`Mon`…`Sun`), `start`/`end` (`"06:00"`).
- **Rates:** `price_per_day` (KSh 500–50,000), `price_per_hour` (KSh 100–10,000).
- **The rest:** `references[]` (up to 3 `{ name, phone }`), `agreed: true`.

Errors are 422 with a readable `detail`/`message` (e.g. "Upload a photo of your driving licence.",
"Upload your ID photo again, then resubmit." when a link isn't theirs). Show them next to the step
they belong to.

### Step 4: status page (`GET /chauffeur/application`)

| `status` | Show |
|---|---|
| `pending` | "Application in review. We'll notify you." Offer **Edit and resubmit** (re-submitting replaces it) |
| `rejected` | `reason`, and highlight the steps holding `fix_fields`; **Fix and resubmit** |
| `approved` | "You're approved! Open the Ardena app → Profile → **Switch to Chauffeur Mode**" + app store links |

Approved drivers run trips in the app. Chauffeur Mode isn't needed on the website.

---

## 7. Checklist

- [ ] `src/api.js`: avatar lookups via the backend; Supabase constants removed
- [ ] `return_to: "web"` on every card payment; new `/payment/result` route
- [ ] Payment page shows `amount_due_now`
- [ ] Delivery: car badge/row, checkout city + address + location, trip page, `delivers_to` filter
- [ ] Pay on pickup: badge, choice, breakdown, trip-page balance actions, handover "awaiting balance"
- [ ] Licence badge on `/license`
- [ ] `/drive` application, working signed out (inline account), with prefill, uploads, base pin and
      status
- [ ] Driver hiring: find, profile, hire, pay, Drivers tab in Trips, chat, cancel, rate
- [ ] All `detail` / `message` errors shown as is

**Backend:** already live, except `return_to` (§1.2), which ships with this guide. Deploy the
backend before the website uses it; an older API ignores the field and falls back to the app link.
