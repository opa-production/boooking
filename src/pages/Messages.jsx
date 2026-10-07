import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import * as api from '../api.js';
import { EmptyState } from '../components.jsx';
import logoMark from '../assets/logo.png';
import { SendIcon, ChatIcon, MailIcon, PhoneIcon, ShieldIcon, ArrowLeftIcon } from '../icons.jsx';

// Real client↔host chat, chats with hired drivers (one per hire), plus the
// Ardena support conversation — same threads as the app. No websocket; we
// fetch on open/send and poll while visible.

const POLL_MS = 15000;
const SUPPORT_ID = 'support';

function fmtMsgTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('en-KE', { day: 'numeric', month: 'short' });
}

function mapMessages(list, meType) {
  return (list || []).map((m) => ({
    id: m.id,
    from: m.sender_type === meType ? 'me' : 'host',
    text: m.message,
    time: fmtMsgTime(m.created_at),
  }));
}

function mapConversation(c) {
  return {
    hostId: c.host_id,
    hostName: c.host_name || 'Ardena host',
    hostAvatar: c.host_avatar_url,
    unread: !c.is_read_by_client,
    lastMessageAt: c.last_message_at,
    startedAt: c.created_at,
    messages: mapMessages(c.messages, 'client'),
  };
}

const DRIVER_PREFIX = 'drv:';
const isDriverKey = (key) => typeof key === 'string' && key.startsWith(DRIVER_PREFIX);

/** A driver-hire chat (GET /chauffeur-threads?role=client). Messages load on open. */
function mapDriverThread(t) {
  return {
    hostId: DRIVER_PREFIX + t.booking_id,
    hireId: t.booking_id,
    isDriver: true,
    hostName: t.name || 'Your driver',
    hostAvatar: t.photo_url,
    unread: (t.unread || 0) > 0,
    lastMessageAt: t.last_at,
    preview: t.last_text,
    trip: t.trip,
    startedAt: null,
    messages: [],
  };
}

function mapDriverMessages(list) {
  return (list || []).map((m) => ({
    id: m.id,
    from: m.sender === 'client' ? 'me' : 'host',
    text: m.text,
    time: fmtMsgTime(m.created_at),
  }));
}

function mapSupport(c) {
  return {
    hostId: SUPPORT_ID,
    hostName: 'Ardena Support',
    hostAvatar: null,
    unread: false,
    lastMessageAt: c?.last_message_at || null,
    startedAt: c?.created_at || null,
    messages: c ? mapMessages(c.messages, 'client') : [],
  };
}

function HostAvatar({ thread, size = 40, fontSize }) {
  const [failed, setFailed] = useState(false);
  if (thread.hostId === SUPPORT_ID) {
    return (
      <span
        className="avatar support-avatar"
        style={{ width: size, height: size, fontSize: fontSize || Math.round(size * 0.4) }}
      >
        <img src={logoMark} alt="Ardena" />
      </span>
    );
  }
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: fontSize || Math.round(size * 0.4) }}
    >
      {thread.hostAvatar && !failed ? (
        <img src={thread.hostAvatar} alt={thread.hostName} onError={() => setFailed(true)} />
      ) : (
        thread.hostName[0]
      )}
    </span>
  );
}

export default function Messages() {
  const { state } = useLocation();
  const [threads, setThreads] = useState([]);
  const [support, setSupport] = useState(mapSupport(null));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeHostId, setActiveHostId] = useState(
    state?.driverHireId ? DRIVER_PREFIX + state.driverHireId : state?.hostId ?? null
  );
  const activeRef = useRef(activeHostId);
  activeRef.current = activeHostId;
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  // Mobile only: the conversation list is a slide-in drawer over the chat.
  const [listOpen, setListOpen] = useState(false);
  const bodyRef = useRef(null);
  const tempIdRef = useRef(-1);

  /** Merge fresh conversations, preserving avatars the single endpoint omits
   * and driver messages already loaded (the inbox only carries the last one). */
  const adoptConversations = useCallback((list) => {
    setThreads((prev) => {
      const prevByHost = new Map(prev.map((t) => [t.hostId, t]));
      return list.map((t) => {
        const before = prevByHost.get(t.hostId);
        return {
          ...t,
          hostAvatar: t.hostAvatar || before?.hostAvatar || null,
          messages: t.isDriver && before?.messages.length ? before.messages : t.messages,
        };
      });
    });
  }, []);

  const loadDriverMessages = useCallback((key) => {
    const hireId = key.slice(DRIVER_PREFIX.length);
    return api
      .getChauffeurMessages(hireId)
      .then((list) => {
        const messages = mapDriverMessages(list);
        setThreads((prev) =>
          prev.map((t) => (t.hostId === key ? { ...t, messages, unread: false } : t))
        );
      })
      .catch(() => {});
  }, []);

  const refresh = useCallback(async () => {
    const [nots, sup, drivers] = await Promise.all([
      api.getConversations(),
      api.getSupportConversation().catch(() => null),
      api.getChauffeurThreads().catch(() => []),
    ]);
    let list = (nots.conversations || []).map(mapConversation);
    let driverList = (Array.isArray(drivers) ? drivers : []).map(mapDriverThread);
    // "Message driver" on a hire with no messages yet: start its thread here.
    if (state?.driverHireId && !driverList.some((t) => t.hireId === state.driverHireId)) {
      driverList = [
        mapDriverThread({
          booking_id: state.driverHireId,
          name: state.driverName,
          photo_url: state.driverPhoto,
          unread: 0,
        }),
        ...driverList,
      ];
    }
    if (state?.hostId && state.hostId !== SUPPORT_ID && !list.some((t) => t.hostId === state.hostId)) {
      try {
        const conv = await api.getConversationWithHost(state.hostId);
        list = [mapConversation(conv), ...list];
      } catch {
        /* host gone — just show existing threads */
      }
    }
    const time = (t) => (t.lastMessageAt ? new Date(t.lastMessageAt).getTime() : Infinity);
    list = [...list, ...driverList].sort((a, b) => time(b) - time(a));
    adoptConversations(list);
    if (sup) setSupport(mapSupport(sup));
    if (isDriverKey(activeRef.current)) loadDriverMessages(activeRef.current);
    return list;
  }, [state?.hostId, state?.driverHireId, adoptConversations, loadDriverMessages]);

  // Initial load
  useEffect(() => {
    let on = true;
    refresh()
      .then((list) => {
        if (!on) return;
        if (activeHostId == null) {
          const first = list.length ? list[0].hostId : SUPPORT_ID;
          setActiveHostId(first);
          if (isDriverKey(first)) loadDriverMessages(first);
        }
      })
      .catch((e) => {
        if (on) {
          setError(e.message || 'Couldn’t load your messages.');
          if (activeHostId == null) setActiveHostId(SUPPORT_ID);
        }
      })
      .finally(() => {
        if (on) setLoading(false);
      });
    return () => {
      on = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Light poll while the tab is visible, so replies appear like in the app.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') refresh().catch(() => {});
    };
    const timer = setInterval(tick, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const openThread = (hostId) => {
    setActiveHostId(hostId);
    setListOpen(false); // reveal the chat on mobile

    if (hostId === SUPPORT_ID) {
      api
        .getSupportConversation()
        .then((c) => setSupport(mapSupport(c)))
        .catch(() => {});
      return;
    }
    setThreads((prev) => prev.map((t) => (t.hostId === hostId ? { ...t, unread: false } : t)));
    if (isDriverKey(hostId)) {
      loadDriverMessages(hostId);
      return;
    }
    api
      .getConversationWithHost(hostId)
      .then((conv) => {
        const mapped = mapConversation(conv);
        setThreads((prev) =>
          prev.map((t) =>
            t.hostId === hostId ? { ...mapped, hostAvatar: mapped.hostAvatar || t.hostAvatar } : t
          )
        );
      })
      .catch(() => {});
  };

  const isSupport = activeHostId === SUPPORT_ID;
  const thread = isSupport
    ? support
    : threads.find((t) => t.hostId === activeHostId) || threads[0] || support;

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [thread?.messages.length, activeHostId]);

  const appendTo = (hostId, updater) => {
    if (hostId === SUPPORT_ID) setSupport((s) => updater(s));
    else setThreads((prev) => prev.map((t) => (t.hostId === hostId ? updater(t) : t)));
  };

  const send = async (e) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !thread || sending) return;
    setSending(true);
    setDraft('');
    const target = thread.hostId;
    const tempId = tempIdRef.current--;
    const optimistic = { id: tempId, from: 'me', text, time: fmtMsgTime(new Date().toISOString()) };
    appendTo(target, (t) => ({ ...t, messages: [...t.messages, optimistic] }));
    try {
      const sent =
        target === SUPPORT_ID
          ? await api.sendSupportMessage(text)
          : isDriverKey(target)
            ? await api.sendChauffeurMessage(target.slice(DRIVER_PREFIX.length), text)
            : await api.sendMessageToHost(target, text);
      appendTo(target, (t) => ({
        ...t,
        lastMessageAt: sent.created_at || t.lastMessageAt,
        messages: t.messages.map((m) =>
          m.id === tempId
            ? {
                id: sent.id,
                from: 'me',
                text: sent.message ?? sent.text,
                time: fmtMsgTime(sent.created_at),
              }
            : m
        ),
      }));
    } catch (err) {
      appendTo(target, (t) => ({ ...t, messages: t.messages.filter((m) => m.id !== tempId) }));
      setDraft(text);
      setError(err.message || 'Couldn’t send the message. Please try again.');
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="page">
        <div className="container wide">
          <div className="msg-layout" aria-hidden="true">
            <div className="msg-list">
              {Array.from({ length: 6 }, (_, i) => (
                <div className="msg-item" key={i}>
                  <span className="skel-circle" style={{ width: 40, height: 40 }} />
                  <span className="msg-item-text" style={{ flex: 1 }}>
                    <span className="skel-line" style={{ width: '55%', marginTop: 0 }} />
                    <span className="skel-line" style={{ width: '78%', height: 12 }} />
                  </span>
                </div>
              ))}
            </div>

            <div className="msg-thread">
              <div className="msg-head">
                <span className="skel-circle" style={{ width: 30, height: 30 }} />
                <span className="skel-line" style={{ width: 150, height: 14, marginTop: 0 }} />
              </div>
              <div className="msg-body">
                {[
                  ['host', '54%'],
                  ['me', '42%'],
                  ['host', '64%'],
                  ['me', '36%'],
                  ['host', '50%'],
                  ['me', '46%'],
                ].map(([side, w], i) => (
                  <div className={`skel-bubble ${side}`} style={{ width: w }} key={i} />
                ))}
              </div>
              <div className="msg-input">
                <span
                  className="skel-line"
                  style={{ flex: 1, height: 44, marginTop: 0, borderRadius: 999 }}
                />
              </div>
            </div>

            <aside className="msg-side">
              <span className="skel-circle" style={{ width: 96, height: 96, margin: '8px 0 10px' }} />
              <span className="skel-line" style={{ width: 130, height: 15, alignSelf: 'center' }} />
              <span className="skel-line" style={{ width: 180, height: 11, alignSelf: 'center' }} />
              <span
                className="skel-line"
                style={{ width: '100%', height: 60, marginTop: 'var(--sp-4)', borderRadius: 14 }}
              />
            </aside>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="container wide">
        <div className="msg-layout">
          {listOpen && (
            <div className="msg-scrim" onClick={() => setListOpen(false)} aria-hidden="true" />
          )}
          <div className={`msg-list${listOpen ? ' open' : ''}`}>
            {/* Ardena support is always available, pinned on top */}
            <button
              className={`msg-item support${isSupport ? ' active' : ''}`}
              onClick={() => openThread(SUPPORT_ID)}
            >
              <HostAvatar thread={support} />
              <span className="msg-item-text">
                <b>Ardena Support</b>
                <span>
                  {support.messages.length
                    ? support.messages[support.messages.length - 1].text
                    : 'We’re here to help, any time'}
                </span>
              </span>
              <span className="msg-item-time">{fmtMsgTime(support.lastMessageAt)}</span>
            </button>

            {threads.map((t) => (
              <button
                key={t.hostId}
                className={`msg-item${!isSupport && t.hostId === thread.hostId ? ' active' : ''}`}
                onClick={() => openThread(t.hostId)}
              >
                <HostAvatar thread={t} />
                <span className="msg-item-text">
                  <b>
                    {t.hostName}
                    {t.unread && <span className="unread-dot" />}
                  </b>
                  <span className={t.unread ? 'unread-preview' : undefined}>
                    {t.messages.length
                      ? t.messages[t.messages.length - 1].text
                      : t.preview || 'New conversation'}
                  </span>
                </span>
                <span className="msg-item-time">{fmtMsgTime(t.lastMessageAt)}</span>
              </button>
            ))}
          </div>

          <div className="msg-thread">
            <div className="msg-head">
              <button
                type="button"
                className="msg-list-toggle"
                aria-label="Show conversations"
                onClick={() => setListOpen(true)}
              >
                <ArrowLeftIcon size={18} />
              </button>
              <HostAvatar thread={thread} size={30} fontSize={13} />
              <b>{thread.hostName}</b>
              {!isSupport && state?.carName && state?.hostId === thread.hostId && (
                <span className="car-meta"> · {state.carName}</span>
              )}
            </div>
            <div className="msg-body" ref={bodyRef}>
              {thread.messages.length === 0 ? (
                <EmptyState
                  variant="compact"
                  icon={<ChatIcon size={22} />}
                  message={
                    isSupport
                      ? 'Ask us anything — bookings, payments, or anything in between.'
                      : `Say hello to ${thread.hostName}`
                  }
                />
              ) : (
                thread.messages.map((m) => (
                  <div key={m.id} className={`bubble ${m.from === 'me' ? 'me' : 'host'}`}>
                    {m.text}
                    <span className="bubble-time">{m.time}</span>
                  </div>
                ))
              )}
            </div>
            {error && (
              <div style={{ color: 'var(--error)', fontSize: 'var(--fs-sm)', fontWeight: 700, padding: '6px 18px' }}>
                {error}
              </div>
            )}
            <form className="msg-input" onSubmit={send}>
              <div className="control" style={{ flex: 1 }}>
                <input
                  placeholder={`Message ${thread.hostName}…`}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
              </div>
              <button
                type="submit"
                className="search-icon-btn"
                style={{ margin: 0 }}
                aria-label="Send"
                disabled={sending}
              >
                <SendIcon size={18} />
              </button>
            </form>
          </div>

          <aside className="msg-side">
            <HostAvatar thread={thread} size={96} fontSize={34} />
            <b style={{ fontSize: 'var(--fs-md)', textAlign: 'center' }}>{thread.hostName}</b>
            {isSupport ? (
              <>
                <div className="car-meta" style={{ textAlign: 'center' }}>
                  Typically replies within a few hours
                </div>
                <div className="widget-rows" style={{ width: '100%', marginTop: 14 }}>
                  <div className="widget-row">
                    <span>
                      <MailIcon size={15} /> Email
                    </span>
                    <b style={{ fontSize: 'var(--fs-xs)' }}>support@ardena.co.ke</b>
                  </div>
                  <div className="widget-row">
                    <span>
                      <PhoneIcon size={15} /> Call
                    </span>
                    <b>+254 707 856 829</b>
                  </div>
                </div>
                <div className="notice" style={{ marginTop: 'var(--sp-1)', fontSize: 'var(--fs-xs)' }}>
                  <ShieldIcon size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />
                  We never ask for your M-Pesa PIN, card details or password.
                </div>
              </>
            ) : (
              <>
                {thread.isDriver ? (
                  <>
                    <div className="car-meta" style={{ textAlign: 'center' }}>
                      Your Ardena driver{thread.trip ? ` · ${thread.trip}` : ''}
                    </div>
                    <Link
                      to={`/driver-hires/${thread.hireId}`}
                      className="btn-secondary btn-block"
                      style={{ marginTop: 'var(--sp-4)', textAlign: 'center' }}
                    >
                      View the hire
                    </Link>
                  </>
                ) : (
                <div className="car-meta" style={{ textAlign: 'center' }}>
                  Ardena host
                  {thread.startedAt
                    ? ` · chatting since ${new Date(thread.startedAt).toLocaleDateString('en-KE', {
                        month: 'short',
                        year: 'numeric',
                      })}`
                    : ''}
                </div>
                )}
                <div className="notice" style={{ marginTop: 'var(--sp-4)', fontSize: 'var(--fs-xs)' }}>
                  <ChatIcon size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />
                  Messages sync with the Ardena app — your {thread.isDriver ? 'driver' : 'host'} sees
                  them there too.
                </div>
              </>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
