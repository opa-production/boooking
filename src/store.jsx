import React, { createContext, useContext, useEffect, useState } from 'react';
import * as api from './api.js';

// `user` is the real client profile from api.ardena.xyz — the same account as
// the client0 app. Wishlist syncs with the wishlist API; bookings live on the
// server and are fetched by the pages that need them.

const AppContext = createContext(null);

/** Map the API client profile (API.md → GET /client/me) to the shape the pages use. */
function mapClient(c) {
  if (!c) return null;
  const parts = (c.full_name || '').trim().split(/\s+/).filter(Boolean);
  return {
    id: c.id,
    fullName: c.full_name || '',
    firstName: parts[0] || 'Ardena',
    lastName: parts.slice(1).join(' '),
    email: c.email,
    phone: c.mobile_number,
    idNumber: c.id_number,
    dob: c.date_of_birth,
    gender: c.gender,
    bio: c.bio,
    avatarUrl: c.avatar_url,
    licenseDocumentUrl: c.license_document_url,
    memberSince: c.created_at ? new Date(c.created_at).getFullYear() : null,
  };
}

export function AppProvider({ children }) {
  // Start from the cached profile so a returning user is signed in instantly,
  // then re-hydrate from the backend below.
  const [client, setClient] = useState(() => (api.hasSession() ? api.loadStoredClient() : null));
  const [wishlist, setWishlist] = useState(() => new Set());
  // True while a stored session exists but its profile hasn't hydrated yet — lets
  // the header hold off on the "Log in" button so it can't flash for a returning user.
  const [authPending, setAuthPending] = useState(() => api.hasSession() && !api.loadStoredClient());

  const adoptProfile = (profile) => {
    api.storeClient(profile);
    setClient(profile);
    // Older profiles don't always carry avatar_url; the backend's avatar
    // lookup finds the file (and saves it back), the same as the app.
    if (profile && !profile.avatar_url && profile.id) {
      api.findClientAvatar(profile.id).then((url) => {
        if (!url) return;
        setClient((current) => {
          if (!current || current.id !== profile.id || current.avatar_url) return current;
          const withAvatar = { ...current, avatar_url: url };
          api.storeClient(withAvatar);
          return withAvatar;
        });
      });
    }
  };

  useEffect(() => {
    if (!api.hasSession()) return undefined;
    let cancelled = false;
    api
      .getMe()
      .then((profile) => {
        if (!cancelled) adoptProfile(profile);
      })
      .catch((e) => {
        // 401 here means the refresh token is dead too — signed out for real.
        if (!cancelled && e.status === 401) setClient(null);
      })
      .finally(() => {
        if (!cancelled) setAuthPending(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Paint wishlist hearts from the server whenever a user is signed in.
  useEffect(() => {
    if (!client) {
      setWishlist(new Set());
      return undefined;
    }
    let cancelled = false;
    api
      .getWishlist()
      .then((data) => {
        if (!cancelled) setWishlist(new Set((data.cars || []).map((c) => String(c.car_id))));
      })
      .catch(() => {
        /* hearts just start unfilled */
      });
    return () => {
      cancelled = true;
    };
  }, [client?.id]);

  /** Optimistic toggle, synced to the wishlist API. Returns false when signed out. */
  const toggleWish = (carId) => {
    if (!client) return false;
    const adding = !wishlist.has(carId);
    setWishlist((prev) => {
      const next = new Set(prev);
      if (adding) next.add(carId);
      else next.delete(carId);
      return next;
    });
    const call = adding ? api.addToWishlist(carId) : api.removeFromWishlist(carId);
    call.catch(() => {
      // Revert on failure
      setWishlist((prev) => {
        const next = new Set(prev);
        if (adding) next.delete(carId);
        else next.add(carId);
        return next;
      });
    });
    return true;
  };

  const signInWithPassword = async (email, password) => {
    adoptProfile(await api.login(email, password));
  };

  const signInWithGoogle = async (idToken) => {
    adoptProfile(await api.loginWithGoogle(idToken));
  };

  const signUp = async ({ fullName, email, password, passwordConfirmation }) => {
    await api.register({ fullName, email, password, passwordConfirmation });
    // Register returns no tokens — log in with the new credentials.
    adoptProfile(await api.login(email, password));
  };

  const signOut = () => {
    api.logout();
    setClient(null);
  };

  /** PUT /client/profile with only the changed fields; adopts the returned profile. */
  const updateProfile = async (fields) => {
    const updated = await api.updateProfile(fields);
    // Some deployments return { client: {...} } or a bare message — fall back to a refetch.
    const profile = updated && updated.id ? updated : (updated && updated.client) || (await api.getMe());
    adoptProfile(profile);
    return profile;
  };

  const value = {
    user: mapClient(client),
    authPending,
    signInWithPassword,
    signInWithGoogle,
    signUp,
    signOut,
    updateProfile,
    wishlist,
    toggleWish,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  return useContext(AppContext);
}
