import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, type User } from './api';

interface AuthValue {
  user: User | null;
  ready: boolean;
  owner: boolean;
  setUser: (u: User | null) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue>({ user: null, ready: false, owner: false, setUser: () => {}, logout: async () => {} });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [owner, setOwner] = useState(false);

  useEffect(() => {
    api
      .me()
      .then((r) => {
        setUser(r.user);
        setOwner(!!r.owner);
      })
      .catch(() => setUser(null))
      .finally(() => setReady(true));
  }, []);

  const logout = useCallback(async () => {
    await api.logout().catch(() => {});
    setUser(null);
  }, []);

  return <AuthContext.Provider value={{ user, ready, owner, setUser, logout }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
