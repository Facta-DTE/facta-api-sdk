// A tiny history router: the playground has five fixed routes and no params.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type AnchorHTMLAttributes, type ReactNode } from "react";

interface RouterValue {
  path: string;
  /** Counts every `navigate` call, so a page can notice a link to its own route with a new query. */
  visits: number;
  navigate(to: string): void;
}

const RouterContext = createContext<RouterValue>({ path: "/", visits: 0, navigate: () => undefined });

export function Router({ children }: { children: ReactNode }) {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const [visits, setVisits] = useState(0);
  const navigate = useCallback((to: string) => {
    const { pathname, search, hash } = window.location;
    if (to === pathname + search + hash) return;
    window.history.pushState(null, "", to);
    // Routes match on the pathname alone: a link may carry a query or a hash.
    setPath(new URL(to, window.location.href).pathname);
    setVisits((count) => count + 1);
    window.scrollTo(0, 0);
  }, []);
  const value = useMemo(() => ({ path, visits, navigate }), [path, visits, navigate]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export const useRoute = () => useContext(RouterContext);

export function Link({ to, onClick, ...rest }: { to: string } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const { navigate } = useRoute();
  return (
    <a
      href={to}
      {...rest}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigate(to);
      }}
    />
  );
}
