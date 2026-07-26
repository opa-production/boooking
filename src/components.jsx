import React, { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useApp } from './store.jsx';
import { useTheme, toggleTheme } from './theme.js';
import { formatKES } from './data.js';
import logoUrl from './assets/logo.svg';
import logomarkUrl from './assets/logomark.svg';
import blueMarkUrl from './assets/blue.png';
import appstoreImg from './assets/appstore.png';
import playImg from './assets/play.png';
import emptyVideo from './assets/empty.webm';
import {
  UserIcon,
  SuitcaseIcon,
  LogOutIcon,
  CheckIcon,
  ChevronDownIcon,
  HeartIcon,
  HeartOutlineIcon,
  ChatIcon,
  CreditCardIcon,
  BellIcon,
  CarIcon,
  ArrowLeftIcon,
  MailIcon,
  PhoneIcon,
  MapPinIcon,
  XBrandIcon,
  InstagramIcon,
  TikTokIcon,
  LinkedInIcon,
  WhatsAppIcon,
  SunIcon,
  MoonIcon,
  XIcon,
} from './icons.jsx';

/** Floating back arrow, far left — shown on pages that have a page to go back to. */
export function BackButton({ to }) {
  const navigate = useNavigate();
  return (
    <button
      className="back-fab"
      aria-label="Go back"
      onClick={() => (to ? navigate(to) : navigate(-1))}
    >
      <ArrowLeftIcon size={20} />
    </button>
  );
}

/** Car photo: shimmer placeholder while loading, fade-in when ready,
 * icon fallback if the image fails. The frame always fills its parent so
 * object-fit: cover crops around the center instead of showing the top slice. */
export function CarPhoto({ car, index = 0, className, onClick }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const src = car.photos[index] || car.photos[0];
  const frameCls = className ? `${className} photo-frame` : 'photo-frame';
  const clickProps = onClick
    ? { onClick, role: 'button', tabIndex: 0, style: { cursor: 'zoom-in' } }
    : {};
  if (failed || !src) {
    return (
      <div className={frameCls} {...clickProps}>
        <div className="ph" style={{ background: 'linear-gradient(135deg, var(--skel-a), var(--skel-b))' }}>
          <CarIcon size={44} style={{ color: 'var(--text-faint)' }} />
        </div>
      </div>
    );
  }
  return (
    <div className={frameCls} {...clickProps}>
      {!loaded && <div className="img-skel" />}
      <img
        src={src}
        alt={car.name}
        loading="lazy"
        className={loaded ? 'loaded' : ''}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
      />
    </div>
  );
}

/** Checkout progress indicator: Trip details → Payment → Confirmed.
 * `current` is 1-based; earlier steps render as done (check), later as pending. */
export function BookingSteps({ current }) {
  const steps = ['Trip details', 'Payment', 'Confirmed'];
  return (
    <div className="booking-steps" aria-label={`Step ${current} of ${steps.length}`}>
      {steps.map((label, i) => {
        const n = i + 1;
        const state = n < current ? 'done' : n === current ? 'active' : '';
        return (
          <React.Fragment key={label}>
            <div className={`bstep ${state}`}>
              <span className="bstep-dot">{n < current ? <CheckIcon size={14} /> : n}</span>
              <span className="bstep-label">{label}</span>
            </div>
            {i < steps.length - 1 && (
              <span className={`bstep-line${n < current ? ' done' : ''}`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

/** Fixed bottom action bar for the key checkout steps (Reserve / Continue to
 * payment / Pay). Phones only — it keeps the primary CTA in reach without
 * scrolling down to the summary card. On desktop it's hidden (CSS) and the
 * in-card button is used instead. `info` is an optional left-side summary
 * (price / total); `children` is the button. */
export function StickyActionBar({ info, children }) {
  return (
    <div className="sticky-action-bar">
      {info && <div className="sab-info">{info}</div>}
      <div className="sab-action">{children}</div>
    </div>
  );
}

/** Reusable empty state. `variant="animation"` shows the empty.webm hero loop
 * (for full-page empties); `variant="compact"` shows an icon in a tinted circle
 * (for panels and inline empties). `action` is an optional button/link node. */
export function EmptyState({ variant = 'animation', icon, title, message, action }) {
  return (
    <div className={`empty-state${variant === 'compact' ? ' empty-state--compact' : ''}`}>
      {variant === 'animation' ? (
        <video className="empty-anim" src={emptyVideo} autoPlay loop muted playsInline />
      ) : (
        icon && <span className="empty-state-icon">{icon}</span>
      )}
      {title && <b>{title}</b>}
      {message && <p>{message}</p>}
      {action}
    </div>
  );
}

/** Shimmer placeholder card shown while the car list loads. */
export function CarCardSkeleton() {
  return (
    <div className="car-card" aria-hidden="true">
      <div className="car-photo">
        <div className="img-skel" />
      </div>
      <div className="car-body">
        <div className="skel-line" style={{ width: '62%' }} />
        <div className="skel-line" style={{ width: '38%' }} />
      </div>
    </div>
  );
}

/** Mastercard interlocking-circles mark (inline SVG, no asset needed). */
export function MastercardMark({ height = 21 }) {
  return (
    <svg
      className="mc-logo"
      style={{ height, width: (height * 36) / 22 }}
      viewBox="0 0 36 22"
      aria-label="Mastercard"
    >
      <circle cx="13" cy="11" r="10" fill="#eb001b" />
      <circle cx="23" cy="11" r="10" fill="#f79e1b" />
      <path d="M18 3.2a10 10 0 0 1 0 15.6 10 10 0 0 1 0-15.6z" fill="#ff5f00" />
    </svg>
  );
}

/** User avatar: profile photo from the API when set, initials otherwise. */
export function Avatar({ user, size = 36, fontSize }) {
  const [failed, setFailed] = useState(false);
  const initials =
    `${user.firstName?.[0] || ''}${user.lastName?.[0] || ''}`.toUpperCase() || 'A';
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: fontSize || Math.round(size * 0.36) }}
    >
      {user.avatarUrl && !failed ? (
        <img src={user.avatarUrl} alt={user.firstName} onError={() => setFailed(true)} />
      ) : (
        initials
      )}
    </span>
  );
}

export function CarCard({ car }) {
  const { wishlist, toggleWish } = useApp();
  const navigate = useNavigate();
  const wished = wishlist.has(car.id);
  return (
    <Link to={`/cars/${car.id}`} className="car-card">
      <div className="car-photo">
        <CarPhoto car={car} />
        <button
          className="wish-btn"
          aria-label="Save to wishlist"
          onClick={(e) => {
            e.preventDefault();
            if (!toggleWish(car.id)) navigate('/login', { state: { next: '/' } });
          }}
        >
          <HeartIcon filled={wished} size={20} />
        </button>
      </div>
      <div className="car-body">
        <div className="car-title-row">
          <div className="car-title">{car.name}</div>
          <div className="rating">{car.rating ? `★ ${car.rating.toFixed(1)}` : 'New'}</div>
        </div>
        <div className="car-price">
          <b>{formatKES(car.pricePerDay)}</b> <span>/ day</span>
        </div>
      </div>
    </Link>
  );
}

export function Toggle({ on, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className={`switch${on ? ' on' : ''}`}
      onClick={() => onChange(!on)}
    />
  );
}

function AccountMenu() {
  const { user, authPending, signOut } = useApp();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  if (!user) {
    // A returning session is still hydrating — reserve the space but don't flash
    // "Log in" before we know whether they're signed in.
    if (authPending) return <span className="account-placeholder" aria-hidden="true" />;
    return (
      <Link to="/login" className="btn-primary" style={{ padding: '11px 24px' }}>
        Log in
      </Link>
    );
  }

  const go = (path) => {
    setOpen(false);
    navigate(path);
  };

  return (
    <div className="account-wrap" ref={ref}>
      <button className="account-btn" onClick={() => setOpen((v) => !v)}>
        <Avatar user={user} />
        {user.firstName}
        <ChevronDownIcon size={15} style={{ color: 'var(--hint)' }} />
      </button>
      {open && (
        <div className="account-menu">
          <div className="who">
            <b>{user.fullName}</b>
            <span>{user.email}</span>
          </div>
          <button className="menu-item" onClick={() => go('/profile')}>
            <UserIcon size={17} /> Profile
          </button>
          <button className="menu-item" onClick={() => go('/trips')}>
            <SuitcaseIcon size={17} /> My trips
          </button>
          <button className="menu-item" onClick={() => go('/messages')}>
            <ChatIcon size={17} /> Messages
          </button>
          <button className="menu-item" onClick={() => go('/notifications')}>
            <BellIcon size={17} /> Notifications
          </button>
          <button className="menu-item" onClick={() => go('/wishlist')}>
            <HeartOutlineIcon size={17} /> Wishlist
          </button>
          <button className="menu-item" onClick={() => go('/payments')}>
            <CreditCardIcon size={17} /> Payment methods
          </button>
          <button
            className="menu-item danger"
            onClick={() => {
              setOpen(false);
              signOut();
              navigate('/');
            }}
          >
            <LogOutIcon size={17} /> Log out
          </button>
        </div>
      )}
    </div>
  );
}

function ThemeButton() {
  const theme = useTheme();
  const dark = theme === 'dark';
  return (
    <button
      className="icon-btn"
      onClick={toggleTheme}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={dark ? 'Light theme' : 'Dark theme'}
    >
      {dark ? <SunIcon size={17} /> : <MoonIcon size={17} />}
    </button>
  );
}

const APP_BANNER_KEY = 'ardena.appBannerDismissed';

/** A small, friendly "keep going in the app" nudge — mobile only, dismissible,
 * and remembered so it never nags twice. Deep-links into the native Ardena app
 * (Android package com.ardena.client), falling back to the relevant store. */
export function AppBanner() {
  // null until we know we're on a phone and the user hasn't dismissed it.
  const [platform, setPlatform] = useState(null);

  useEffect(() => {
    let stored;
    try {
      stored = localStorage.getItem(APP_BANNER_KEY);
    } catch {
      stored = null;
    }
    if (stored === '1') return;
    const ua = navigator.userAgent || '';
    if (/android/i.test(ua)) setPlatform('android');
    else if (/iphone|ipad|ipod/i.test(ua)) setPlatform('ios');
  }, []);

  if (!platform) return null;

  // Android: open the app if it's installed (App Links), else land on Play.
  const androidHref =
    'intent://bookings.ardena.co.ke/#Intent;scheme=https;package=com.ardena.client;' +
    'S.browser_fallback_url=' +
    encodeURIComponent('https://play.google.com/store/apps/details?id=com.ardena.client') +
    ';end';
  const href = platform === 'android' ? androidHref : 'https://apps.apple.com/app/id6772513965';

  const dismiss = () => {
    try {
      localStorage.setItem(APP_BANNER_KEY, '1');
    } catch {
      /* private mode — just hide for this session */
    }
    setPlatform(null);
  };

  return (
    <div className="app-banner" role="complementary" aria-label="Open in the Ardena app">
      <span className="app-banner-mark">
        <img src={blueMarkUrl} alt="" />
      </span>
      <div className="app-banner-copy">
        <b>Smoother in the app</b>
        <span>Book, pay and chat in a tap</span>
      </div>
      <a className="app-banner-open" href={href}>
        Open
      </a>
      <button className="app-banner-close" aria-label="Not now" onClick={dismiss}>
        <XIcon size={15} />
      </button>
    </div>
  );
}

export function Header() {
  // Flat at the top of the page; the shadow only appears once you scroll.
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className={`header${scrolled ? ' scrolled' : ''}`}>
      <div className="header-inner">
        <Link to="/" className="logo" aria-label="Ardena">
          <img src={logomarkUrl} alt="Ardena" className="logo-mark-img" />
        </Link>
        <nav className="header-nav">
          <NavLink to="/" end className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            Browse cars
          </NavLink>
          <NavLink to="/trips" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            My trips
          </NavLink>
          <ThemeButton />
          <AccountMenu />
        </nav>
      </div>
    </header>
  );
}

// Mirrors the ardena.co.ke footer (ardena-web/index.html) with a Bookings column added.
const SOCIALS = [
  { label: 'X', href: 'https://x.com/ardenaAfrica', Icon: XBrandIcon },
  {
    label: 'LinkedIn',
    href: 'https://www.linkedin.com/company/ardena-group/',
    Icon: LinkedInIcon,
  },
  {
    label: 'Instagram',
    href: 'https://www.instagram.com/ardena_carrental?igsh=MTE4YmlkdDg4em82MQ==',
    Icon: InstagramIcon,
  },
  { label: 'TikTok', href: 'https://vm.tiktok.com/ZS9RaPxsdJxNK-LfM8K/', Icon: TikTokIcon },
  { label: 'WhatsApp', href: 'https://wa.me/254702248984', Icon: WhatsAppIcon },
];

const APP_STORE_URL = 'https://apps.apple.com/app/ardena/id6772513965';
const PLAY_STORE_URL = 'https://play.google.com/store/apps/dev?id=6656048407762494190';

const ext = { target: '_blank', rel: 'noopener noreferrer' };

export function Footer() {
  return (
    <footer className="footer">
      <div className="footer-wrapper">
        <div className="footer-top">
          <Link to="/" className="footer-brand">
            <img src={logoUrl} alt="Ardena" className="footer-logo" />
          </Link>
          <p className="footer-tagline">
            Trusted car rental in Kenya. Connect with verified owners and renters.
          </p>
        </div>
        <hr className="footer-divider" />
        <div className="footer-main">
          <div className="footer-col">
            <h4 className="footer-col-title">Bookings</h4>
            <ul className="footer-links">
              <li>
                <Link to="/">Browse cars</Link>
              </li>
              <li>
                <Link to="/trips">My trips</Link>
              </li>
              <li>
                <Link to="/wishlist">Wishlist</Link>
              </li>
              <li>
                <Link to="/messages">Messages</Link>
              </li>
              <li>
                <Link to="/payments">Payment methods</Link>
              </li>
              <li>
                <Link to="/profile">Profile</Link>
              </li>
            </ul>
          </div>
          <div className="footer-col">
            <h4 className="footer-col-title">Company</h4>
            <ul className="footer-links">
              <li>
                <a href="https://ardena.co.ke/about" {...ext}>
                  About Us
                </a>
              </li>
              <li>
                <a href="https://ardena.co.ke/teams" {...ext}>
                  Team
                </a>
              </li>
              <li>
                <a href="https://ardena.co.ke/help" {...ext}>
                  Help
                </a>
              </li>
              <li>
                <a href="https://business.ardena.co.ke" {...ext}>
                  Ardena Business
                </a>
              </li>
              <li>
                <a href="https://brandfetch.com/ardena.co.ke" {...ext}>
                  Brand Kit
                </a>
              </li>
            </ul>
          </div>
          <div className="footer-col">
            <h4 className="footer-col-title">Locations</h4>
            <ul className="footer-links">
              <li>
                <a href="https://ardena.co.ke/car-rental-nairobi" {...ext}>
                  Nairobi
                </a>
              </li>
              <li>
                <a href="https://ardena.co.ke/car-rental-mombasa" {...ext}>
                  Mombasa
                </a>
              </li>
              <li>
                <a href="https://ardena.co.ke/car-rental-kisumu" {...ext}>
                  Kisumu
                </a>
              </li>
              <li>
                <a href="https://ardena.co.ke/car-rental-nakuru" {...ext}>
                  Nakuru
                </a>
              </li>
            </ul>
          </div>
          <div className="footer-col">
            <h4 className="footer-col-title">Contact</h4>
            <ul className="footer-contact">
              <li>
                <a href="mailto:support@ardena.co.ke">
                  <span className="footer-contact-icon" aria-hidden="true">
                    <MailIcon size={15} />
                  </span>
                  support@ardena.co.ke
                </a>
              </li>
              <li>
                <span className="footer-contact-icon" aria-hidden="true">
                  <PhoneIcon size={15} />
                </span>
                +254 707 856 829
              </li>
              <li>
                <span className="footer-contact-icon" aria-hidden="true">
                  <MapPinIcon size={15} />
                </span>
                Nakuru, Kenya
              </li>
            </ul>
          </div>
          <div className="footer-social-block">
            <div className="footer-social">
              {SOCIALS.map(({ label, href, Icon }) => (
                <a key={label} href={href} className="footer-social-icon" aria-label={label} {...ext}>
                  <Icon size={20} />
                </a>
              ))}
            </div>
            <div className="footer-store-badges">
              <a
                href={APP_STORE_URL}
                className="footer-store-badge footer-store-badge--appstore"
                aria-label="Download on the App Store"
                {...ext}
              >
                <img src={appstoreImg} alt="" className="footer-store-badge-img" />
              </a>
              <a
                href={PLAY_STORE_URL}
                className="footer-store-badge"
                aria-label="Get it on Google Play"
                {...ext}
              >
                <img src={playImg} alt="" className="footer-store-badge-img" />
              </a>
            </div>
          </div>
        </div>
        <hr className="footer-divider" />
        <div className="footer-bottom">
          <p className="footer-copyright">© {new Date().getFullYear()} ardena. All rights reserved.</p>
          <div className="footer-legal">
            <a href="https://ardena.co.ke/terms" {...ext}>
              Terms &amp; Conditions
            </a>
            <a href="https://ardena.co.ke/privacy" {...ext}>
              Privacy Policy
            </a>
            <a href="https://ardena.co.ke/legal" {...ext}>
              Legal
            </a>
            <a href="https://ardena.co.ke/insurance" {...ext}>
              Insurance &amp; Protection
            </a>
            <a href="https://ardena.co.ke/delete-account" {...ext}>
              Delete Account &amp; Data
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
