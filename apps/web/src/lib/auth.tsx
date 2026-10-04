import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, refreshSession, setAccessToken, setLogoutHandler, type R } from './api';
import i18n from './i18n';

export interface Me {
  userId: string;
  companyId: string;
  email: string;
  displayName: string;
  language: string;
  employeeId: string | null;
  roles: string[];
  permissions: Record<string, string>;
  mustChangePassword: boolean;
}

interface AuthState {
  me: Me | null;
  loading: boolean;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  reload(): Promise<void>;
  can(...codes: string[]): boolean;
  /** Scope of a permission, e.g. COMPANY. */
  scope(code: string): string | undefined;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const qc = useQueryClient();

  const loadMe = useCallback(async () => {
    const m = await api<Me>('GET', '/auth/me');
    setMe(m);
    const lang = localStorage.getItem('ihrm.lang') ?? m.language;
    if (lang && lang !== i18n.language) await i18n.changeLanguage(lang);
  }, []);

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => undefined);
    setAccessToken(null);
    setMe(null);
    qc.clear();
  }, [qc]);

  useEffect(() => {
    setLogoutHandler(() => {
      setAccessToken(null);
      setMe(null);
    });
    (async () => {
      try {
        if (await refreshSession()) await loadMe();
      } finally {
        setLoading(false);
      }
    })();
  }, [loadMe]);

  const value = useMemo<AuthState>(
    () => ({
      me,
      loading,
      async login(email, password) {
        const r = await api<R>('POST', '/auth/login', { email, password });
        setAccessToken(r.accessToken);
        await loadMe();
      },
      logout,
      reload: loadMe,
      can: (...codes) => !!me && codes.some((c) => c in me.permissions),
      scope: (code) => me?.permissions[code],
    }),
    [me, loading, loadMe, logout],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
