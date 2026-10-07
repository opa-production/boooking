import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import { applyTheme } from './theme.js';

// Paint the saved theme before first render so there's no light flash.
applyTheme();

// Paystack sends card payers back to a real path (/payment/result?reference=…);
// the app routes on the hash, so move it there before the router reads it.
if (window.location.pathname.replace(/\/+$/, '') === '/payment/result') {
  window.history.replaceState(null, '', `/#/payment/result${window.location.search}`);
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
