import React, { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApp } from '../store.jsx';
import { hasSession } from '../api.js';
import {
  pollPayment,
  paidItemPath,
  CARD_POLL_TRIES,
  PAYMENT_RETURN_MESSAGE,
} from '../payments.js';
import { CheckIcon, ClockIcon, XIcon } from '../icons.jsx';

/**
 * Paystack sends card payers here (return_to: "web"). Public route.
 * - Opened from our checkout tab: tell that tab and close; it's already polling.
 * - Otherwise: poll the payment status here and show the outcome.
 */
export default function PaymentResult() {
  const [params] = useSearchParams();
  const reference = params.get('reference') || params.get('trxref') || '';
  const { user } = useApp();
  // checking | completed | failed | timeout | closing
  const [phase, setPhase] = useState('checking');
  const [result, setResult] = useState(null);
  const cancelled = useRef(false);

  useEffect(() => {
    let opener = null;
    try {
      // Same origin only: reading location throws for anyone else.
      if (window.opener && window.opener.location.origin === window.location.origin) {
        opener = window.opener;
      }
    } catch {
      opener = null;
    }
    if (opener) {
      opener.postMessage({ type: PAYMENT_RETURN_MESSAGE, reference }, window.location.origin);
      setPhase('closing');
      window.close();
      // Some browsers refuse to close a tab; fall through to checking it here.
      const t = setTimeout(() => setPhase('checking'), 600);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [reference]);

  const checking = phase === 'checking';
  useEffect(() => {
    if (!checking || !reference || !hasSession()) return undefined;
    cancelled.current = false;
    pollPayment(
      { paystack_reference: reference },
      { tries: CARD_POLL_TRIES, isCancelled: () => cancelled.current }
    ).then((status) => {
      if (!status) return;
      setResult(status);
      setPhase(status.status === 'completed' ? 'completed' : status.status === 'timeout' ? 'timeout' : 'failed');
    });
    return () => {
      cancelled.current = true;
    };
    // user?.id: start polling once the payer logs in
  }, [checking, reference, user?.id]);

  const itemPath = paidItemPath(result?.booking_id);
  const isHire = String(result?.booking_id || '').startsWith('chb_');

  let icon = <ClockIcon size={30} />;
  let title = 'Checking your payment…';
  let body = 'This takes a few seconds. You can keep this page open.';
  let tone = '';

  if (!reference) {
    title = 'No payment to check';
    body = 'This link is missing its payment reference.';
  } else if (phase === 'closing') {
    title = 'Payment done';
    body = 'Taking you back to Ardena…';
  } else if (!user && !hasSession()) {
    title = 'Log in to see your payment';
    body = 'Your payment went to Paystack. Log in with your Ardena account to check how it went.';
  } else if (phase === 'completed') {
    icon = <CheckIcon size={30} />;
    tone = 'ok';
    title = 'Payment received';
    body = isHire ? 'Your driver hire is paid.' : 'Your booking is paid and confirmed.';
  } else if (phase === 'failed') {
    icon = <XIcon size={30} />;
    tone = 'bad';
    title = 'Payment didn’t go through';
    body = result?.message || `Payment ${result?.status || 'failed'}. You can try again.`;
  } else if (phase === 'timeout') {
    title = 'Still waiting for confirmation';
    body = 'We haven’t heard back from Paystack yet. Check your trip in a minute.';
  }

  return (
    <div className="page container">
      <div className={`form-card result-card ${tone}`}>
        <span className="result-icon">{icon}</span>
        <h1 className="page-title" style={{ marginBottom: 6 }}>
          {title}
        </h1>
        <p className="page-sub">{body}</p>
        {reference && !user && !hasSession() ? (
          <Link
            to="/login"
            state={{ next: `/payment/result?reference=${encodeURIComponent(reference)}` }}
            className="btn-primary"
          >
            Log in
          </Link>
        ) : result?.booking_id ? (
          <Link to={itemPath} className="btn-primary">
            {isHire ? 'View your driver hire' : 'View your trip'}
          </Link>
        ) : (
          phase !== 'checking' &&
          phase !== 'closing' && (
            <Link to="/trips" className="btn-primary">
              Go to my trips
            </Link>
          )
        )}
      </div>
    </div>
  );
}
