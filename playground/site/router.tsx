// A tiny history router: the playground has five fixed routes and no params.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type AnchorHTMLAttributes, type ReactNode } from "react";

interface RouterValue {
  path: string;
  navigate(to: string): void;
}

const RouterContext = createContext<RouterValue>({ path: "/", navigate: () => undefined });

export function Router({ children }: { children: ReactNode }) {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const navigate = useCallback((to: string) => {
    if (to === window.location.pathname) return;
    window.history.pushState(null, "", to);
    setPath(to);
    window.scrollTo(0, 0);
  }, []);
  const value = useMemo(() => ({ path, navigate }), [path, navigate]);
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
