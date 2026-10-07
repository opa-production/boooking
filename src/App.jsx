import React from 'react';
import { HashRouter, Routes, Route, Navigate, useLocation, Link } from 'react-router-dom';
import { useEffect } from 'react';
import { AppProvider, useApp } from './store.jsx';
import { ToastProvider } from './toast.jsx';
import { Header, Footer, AppBanner } from './components.jsx';
import Home from './pages/Home.jsx';
import CarDetails from './pages/CarDetails.jsx';
import Booking from './pages/Booking.jsx';
import Payment from './pages/Payment.jsx';
import Confirmation from './pages/Confirmation.jsx';
import Trips from './pages/Trips.jsx';
import TripDetails from './pages/TripDetails.jsx';
import Login, { Signup, Forgot } from './pages/Login.jsx';
import { Profile, License } from './pages/Account.jsx';
import Messages from './pages/Messages.jsx';
import Wishlist from './pages/Wishlist.jsx';
import Payments from './pages/Payments.jsx';
import Notifications from './pages/Notifications.jsx';
import PaymentResult from './pages/PaymentResult.jsx';
import Drive from './pages/Drive.jsx';
import { FindDrivers, DriverProfile, HireDriver, DriverHireDetails } from './pages/Chauffeurs.jsx';

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

/** Logged-out users hitting a protected page are sent to the login page,
 * then returned to where they were heading. */
function RequireAuth({ children }) {
  const { user } = useApp();
  const location = useLocation();
  if (!user) {
    return <Navigate to="/login" state={{ next: location.pathname + location.search }} replace />;
  }
  return children;
}

// Focused pages (auth, account, checkout) skip the footer so nothing
// competes with the task at hand.
const HIDE_FOOTER = [
  /^\/login$/,
  /^\/signup$/,
  /^\/forgot$/,
  /^\/profile$/,
  /^\/license$/,
  /^\/pay$/,
  /^\/book\//,
  /^\/confirmed\//,
  /^\/wishlist$/,
  /^\/payments$/,
  /^\/notifications$/,
  /^\/messages$/,
  /^\/payment\/result$/,
  /^\/drive$/,
  /^\/chauffeurs\/[^/]+\/hire$/,
];

function FooterGate() {
  const { pathname } = useLocation();
  if (HIDE_FOOTER.some((re) => re.test(pathname))) return null;
  return <Footer />;
}

function NotFound() {
  return (
    <div className="page container">
      <div className="notfound">
        <svg
          className="face"
          viewBox="0 0 320 380"
          aria-label="A 404 becomes a face, looks to the sides, and blinks."
        >
          <g
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="25"
          >
            <g className="face__eyes" transform="translate(0, 112.5)">
              <g transform="translate(15, 0)">
                <polyline className="face__eye-lid" points="37,0 0,120 75,120" />
                <polyline className="face__pupil" points="55,120 55,155" strokeDasharray="35 35" />
              </g>
              <g transform="translate(230, 0)">
                <polyline className="face__eye-lid" points="37,0 0,120 75,120" />
                <polyline className="face__pupil" points="55,120 55,155" strokeDasharray="35 35" />
              </g>
            </g>
            <rect className="face__nose" rx="4" ry="4" x="132.5" y="112.5" width="55" height="155" />
            <g strokeDasharray="102 102" transform="translate(65, 334)">
              <path className="face__mouth-left" d="M 0 30 C 0 30 40 0 95 0" strokeDashoffset="-102" />
              <path className="face__mouth-right" d="M 95 0 C 150 0 190 30 190 30" strokeDashoffset="102" />
            </g>
          </g>
        </svg>
        <div className="notfound-code" aria-hidden="true">404</div>
        <b>This page took a wrong turn</b>
        <p>The page you&apos;re looking for doesn&apos;t exist or may have moved.</p>
        <Link to="/" className="btn-primary">
          Back to browsing
        </Link>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <ToastProvider>
        <HashRouter>
          <ScrollToTop />
          <Header />
          <AppBanner />
          <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/cars/:id" element={<CarDetails />} />
          <Route path="/book/:id" element={<RequireAuth><Booking /></RequireAuth>} />
          <Route path="/pay" element={<RequireAuth><Payment /></RequireAuth>} />
          <Route path="/confirmed/:id" element={<RequireAuth><Confirmation /></RequireAuth>} />
          <Route path="/trips" element={<RequireAuth><Trips /></RequireAuth>} />
          <Route path="/trips/:id" element={<RequireAuth><TripDetails /></RequireAuth>} />
          <Route path="/messages" element={<RequireAuth><Messages /></RequireAuth>} />
          <Route path="/wishlist" element={<RequireAuth><Wishlist /></RequireAuth>} />
          <Route path="/payments" element={<RequireAuth><Payments /></RequireAuth>} />
          <Route path="/notifications" element={<RequireAuth><Notifications /></RequireAuth>} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/forgot" element={<Forgot />} />
          <Route path="/profile" element={<RequireAuth><Profile /></RequireAuth>} />
          <Route path="/license" element={<RequireAuth><License /></RequireAuth>} />
          <Route path="/payment/result" element={<PaymentResult />} />
          <Route path="/drive" element={<Drive />} />
          <Route path="/chauffeurs" element={<RequireAuth><FindDrivers /></RequireAuth>} />
          <Route path="/chauffeurs/:id" element={<RequireAuth><DriverProfile /></RequireAuth>} />
          <Route path="/chauffeurs/:id/hire" element={<RequireAuth><HireDriver /></RequireAuth>} />
          <Route path="/driver-hires/:id" element={<RequireAuth><DriverHireDetails /></RequireAuth>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
        <FooterGate />
        </HashRouter>
      </ToastProvider>
    </AppProvider>
  );
}
