// Share links for cars: https://booking.ardena.co.ke/cars/:id
//
// The site routes with a hash (/#/cars/:id), and nothing after '#' ever
// reaches a server — so link-preview crawlers (WhatsApp, iMessage, Telegram…)
// would only ever see the site-wide card. The Ardena app therefore shares the
// clean path /cars/:id, which vercel.json rewrites to this function:
//
//   - people are redirected to /#/cars/:id, the car's page in the app;
//   - preview crawlers get a small page with that car's Open Graph tags, so
//     the chat shows its photo, name and price.
//
// Car data comes from the public API (no login). The photo is the car's cover
// image, resized to 1200×630 (~150 KB) by Supabase's image transformer.

const API = 'https://api.ardena.xyz/api/v1';
const SITE = 'https://booking.ardena.co.ke';
const FALLBACK_IMAGE = `${SITE}/og-share.jpg`; // 1200×630 JPEG, ~12 KB
const PREVIEWERS = /whatsapp|facebookexternalhit|facebot|twitterbot|telegrambot|slackbot|linkedinbot|discordbot|applebot|pinterest|skypeuripreview|googlebot|bingbot|embedly|redditbot/i;

// WhatsApp's own in-app browser says "WhatsApp" too, but a real browser's
// user agent starts with "Mozilla/"; the WhatsApp link fetcher's never does.
const IN_APP_BROWSER = /whatsapp|FBAN|FBAV|Instagram/i;
const isPreviewer = (ua) => PREVIEWERS.test(ua) && !(/^Mozilla\//.test(ua) && IN_APP_BROWSER.test(ua));

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ksh = (n) => `KSh ${Math.round(Number(n) || 0).toLocaleString('en-KE')}`;

const shareImage = (cover) => (cover && cover.includes('/storage/v1/object/public/')
  ? `${cover.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/')}?width=1200&height=630&resize=cover&quality=75`
  : null);

async function loadCar(id) {
  try {
    const res = await fetch(`${API}/cars/${encodeURIComponent(id)}`, { headers: { accept: 'application/json' } });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

function previewPage(car, id) {
  const pageUrl = `${SITE}/cars/${encodeURIComponent(id)}`;
  const name = car ? [car.name, car.model, car.year].filter(Boolean).join(' ') : null;
  const title = car ? `${name} · ${ksh(car.daily_rate)}/day` : 'Rent cars and hire drivers on Ardena';
  const description = car
    ? `${[car.transmission, car.seats && `${car.seats} seats`, car.fuel_type, car.location_name || car.host_city].filter(Boolean).join(' · ')}. Book it on Ardena.`
    : 'Rent a car in Kenya, or hire a verified chauffeur.';
  const resized = car ? shareImage(car.cover_image) : null;
  const image = resized || FALLBACK_IMAGE;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${esc(title)} · Ardena</title>
<meta name="description" content="${esc(description)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Ardena">
<meta property="og:url" content="${esc(pageUrl)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:secure_url" content="${esc(image)}">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(name || 'Ardena')}">
<meta property="og:locale" content="en_KE">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(image)}">
<link rel="canonical" href="${esc(pageUrl)}">
<script>location.replace(${JSON.stringify(`/#/cars/${encodeURIComponent(id)}`)});</script>
</head><body><a href="${esc(`${SITE}/#/cars/${encodeURIComponent(id)}`)}">${esc(title)}</a></body></html>`;
}

export default async function handler(req, res) {
  const id = String(req.query?.id || '').trim();
  const ua = req.headers['user-agent'] || '';

  // People: straight to the car's page in the site.
  if (!isPreviewer(ua)) {
    res.statusCode = 302;
    res.setHeader('Location', id ? `/#/cars/${encodeURIComponent(id)}` : '/');
    res.setHeader('Cache-Control', 'no-store');
    return res.end();
  }

  // Crawlers: the car's card. Always 200 — a 404 leaves the chat card blank.
  // The page also redirects with script, in case a person ever lands on it
  // (crawlers don't run it).
  const car = id ? await loadCar(id) : null;
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // Never cached: the edge cache keys on the URL, not the user agent, so a
  // cached card would be served to people too.
  res.setHeader('Cache-Control', 'no-store');
  return res.end(previewPage(car, id));
}
