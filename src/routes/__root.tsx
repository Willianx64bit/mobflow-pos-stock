import "../lib/network-monitor";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { mobflowAuthClient } from "@/lib/auth-client";
import { hydrateStore, hydrateStoreOffline, resumeOnlineSync } from "@/lib/store";
import { LoginScreen } from "@/components/LoginScreen";

declare global {
  interface Window {
    mobflowDesktop?: {
      retryConnection: () => void;
      cacheAuthorizedSession?: (session: { accountId: string; role: string; username: string; permissions: string[] }) => Promise<boolean>;
      getCachedAuthorizedSession?: () => Promise<{ accountId: string; role: string; username: string; permissions: string[]; savedAt: number } | null>;
      clearCachedAuthorizedSession?: () => Promise<boolean>;
    };
  }
}

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">The page you're looking for doesn't exist or has been moved.</p>
        <div className="mt-6">
          <Link to="/" className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">Go home</Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  const router = useRouter();

  console.error(error);
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">This page didn't load</h1>
        <p className="mt-2 text-sm text-muted-foreground">Something went wrong while opening this screen.</p><div className="mt-3 max-w-full overflow-auto rounded-lg bg-secondary/60 p-3 text-left font-mono text-[11px] text-muted-foreground break-words">{error instanceof Error ? error.message : String(error)}</div>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button onClick={() => { router.invalidate(); reset(); }} className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">Try again</button>
          <a href="/" className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent">Go home</a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "MobFlow PDV | Sistema de Vendas e Controle de Estoque" },
      { name: "description", content: "Conheça o MobFlow, sistema de PDV para vendas, controle de estoque, conferência de mercadorias, validade de produtos, fiado e gestão da sua empresa." },
      { name: "keywords", content: "MobFlow, MobFlow PDV, sistema PDV, sistema de vendas, controle de estoque, gestão de comércio, validade de produtos, conferência de mercadorias" },
      { property: "og:site_name", content: "MobFlow" },
      { property: "og:title", content: "MobFlow PDV | Sistema de Vendas e Controle de Estoque" },
      { property: "og:description", content: "Organize vendas, estoque, conferência, validade e gestão da sua empresa com o MobFlow." },
      { name: "twitter:title", content: "MobFlow PDV | Vendas e Estoque" },
      { name: "twitter:description", content: "Sistema para organizar vendas, estoque e gestão do seu comércio." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" },
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/mobflow-icon.svg?v=2", type: "image/svg+xml" },
      { rel: "shortcut icon", href: "/mobflow-icon.svg?v=2", type: "image/svg+xml" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <HeadContent />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({ "@context": "https://schema.org", "@type": "SoftwareApplication", name: "MobFlow", applicationCategory: "BusinessApplication", operatingSystem: "Web", description: "Sistema de PDV para vendas, controle de estoque, conferência, validade de produtos e gestão de comércio.", url: "https://mobflow-pos-stock.vercel.app/" }) }} />
        <style>{`html { scrollbar-color: var(--border) var(--background); }
          ::-webkit-scrollbar { width: 10px; height: 10px; }
          ::-webkit-scrollbar-track { background: var(--background); }
          ::-webkit-scrollbar-thumb { background: var(--border); border: 2px solid var(--background); border-radius: 999px; }
          .dark input[type="range"] { color-scheme: dark; }`}</style>
      </head>
      <body>{children}<Scripts /></body>
    </html>
  );
}

function RouteLoadingBar() {
  return (
    <div role="status" aria-live="polite" aria-label="Carregando tela" className="mf-route-loading-bar">
      <span />
      <style>{`
        .mf-route-loading-bar {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          height: 2px;
          z-index: 10000;
          overflow: hidden;
          pointer-events: none;
          background: transparent;
        }
        .mf-route-loading-bar > span {
          display: block;
          width: 34%;
          height: 2px;
          border-radius: 999px;
          background: #7dd3fc;
          box-shadow: 0 0 5px #7dd3fc, 0 0 11px #38bdf8, 0 0 18px rgb(56 189 248 / 85%);
          animation: mf-route-loading-sweep 1s ease-in-out infinite;
        }
        @keyframes mf-route-loading-sweep {
          from { transform: translateX(-110%); }
          to { transform: translateX(310%); }
        }
        @media (prefers-reduced-motion: reduce) {
          .mf-route-loading-bar > span { animation: none; width: 100%; }
        }
      `}</style>
    </div>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const previousPath = useRef(pathname);
  const loadingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showRouteLoading, setShowRouteLoading] = useState(false);

  useEffect(() => {
    if (previousPath.current === pathname) return;
    const previous = previousPath.current;
    previousPath.current = pathname;
    if (loadingTimer.current) clearTimeout(loadingTimer.current);

    // Promoções pede senha própria, então não precisa do carregamento padrão.
    // Nas demais telas, inclusive Estoque, Recebimento, Vendas e Configurações,
    // manter o carregamento padrão ao entrar.
    const enteringPromotions = pathname === "/promocoes";

    // Ao voltar de uma tela de operação para o menu Operações, não exibir overlay.
    const operationScreens = ["/baixa-produtos", "/transferencias", "/balanco-estoque", "/conferencia", "/fornecedores-clientes"];
    const returningToOperations = pathname === "/operacoes" && operationScreens.includes(previous);
    if (enteringPromotions || returningToOperations) {
      setShowRouteLoading(false);
      loadingTimer.current = null;
      return;
    }

    setShowRouteLoading(true);
    loadingTimer.current = setTimeout(() => {
      setShowRouteLoading(false);
      loadingTimer.current = null;
    }, 1600);
    return () => {
      if (loadingTimer.current) clearTimeout(loadingTimer.current);
    };
  }, [pathname]);

  useEffect(() => () => {
    if (loadingTimer.current) clearTimeout(loadingTimer.current);
  }, []);
  const [checkingSession, setCheckingSession] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [userLoginRequired, setUserLoginRequired] = useState(false);

  useEffect(() => {
    const onAuthChanged = () => { setAuthenticated(false); setUserLoginRequired(false); };
    const onUserLogout = () => { setUserLoginRequired(true); sessionStorage.removeItem("mobflow-desktop-offline"); void window.mobflowDesktop?.clearCachedAuthorizedSession?.(); };
    const onOffline = () => {
      if (window.mobflowDesktop && localStorage.getItem("mobflow:owner")) {
        sessionStorage.setItem("mobflow-desktop-offline", "1");
      }
    };
    const onOnline = async () => {
      if (!window.mobflowDesktop || sessionStorage.getItem("mobflow-desktop-offline") !== "1") return;
      try {
        const response = await fetch("/api/mobflow/session-context", { credentials: "same-origin" });
        if (response.status === 401 || response.status === 403) {
          await window.mobflowDesktop.clearCachedAuthorizedSession?.();
          sessionStorage.removeItem("mobflow-desktop-offline");
          localStorage.removeItem("mobflow-authenticated");
          setAuthenticated(false);
          setUserLoginRequired(false);
          return;
        }
        if (!response.ok) return;
        const synchronized = await resumeOnlineSync();
        if (synchronized) sessionStorage.removeItem("mobflow-desktop-offline");
      } catch {
        // A rede persistente ainda não voltou; mantém o estado local e tenta novamente no próximo evento online.
      }
    };
    const onFocus = () => {
      if (window.mobflowDesktop && sessionStorage.getItem("mobflow-desktop-offline") === "1" && navigator.onLine) {
        void onOnline();
      }
    };
    window.addEventListener("mobflow-auth-changed", onAuthChanged);
    window.addEventListener("mobflow-user-logout", onUserLogout);
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("mobflow-auth-changed", onAuthChanged);
      window.removeEventListener("mobflow-user-logout", onUserLogout);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  useEffect(() => {
    if (!window.mobflowDesktop || !("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.register("/mobflow-desktop-sw.js", { scope: "/" })
      .catch((error) => console.warn("MobFlow Desktop: cache do aplicativo indisponível:", error));
  }, []);

  useEffect(() => {
    let active = true;
    const bootstrap = async () => {
      try {
        let profile: { accountId: string; role: string; username: string; active?: boolean; permissions?: unknown } | null = null;
        let restoredOffline = false;

        try {
          const response = await fetch("/api/mobflow/session-context", { credentials: "same-origin" });
          if (response.ok) {
            const body = await response.json();
            if (body?.ok && body.user && typeof body.accountId === "string") profile = { ...body.user, accountId: body.accountId, active: true };
          } else if (response.status === 401 || response.status === 403) {
            await window.mobflowDesktop?.clearCachedAuthorizedSession?.();
          } else if (response.status >= 500) {
            throw new Error("Servidor indisponível; tentando recuperar a sessão local");
          }
        } catch {
          const cached = await window.mobflowDesktop?.getCachedAuthorizedSession?.();
          const cachedPermissions = Array.isArray(cached?.permissions) ? cached.permissions : [];
          if (cached && cached.role === "pdv" && cachedPermissions.includes("PDV") &&
              typeof cached.accountId === "string" && typeof cached.username === "string") {
            profile = { accountId: cached.accountId, role: cached.role, username: cached.username, permissions: cachedPermissions, active: true };
            restoredOffline = true;
          }
        }

        if (!profile || profile.active === false || profile.role === "admin" ||
            (restoredOffline && profile.role !== "pdv")) {
          if (!restoredOffline) await mobflowAuthClient.signOut().catch(() => undefined);
          localStorage.removeItem("mobflow-authenticated");
          sessionStorage.removeItem("mobflow-role");
          sessionStorage.removeItem("mobflow-username");
          sessionStorage.removeItem("mobflow-pdv-authorized");
          sessionStorage.removeItem("mobflow-desktop-offline");
          if (active) {
            setAuthenticated(false);
            setCheckingSession(false);
          }
          return;
        }

        sessionStorage.setItem("mobflow-role", profile.role);
        sessionStorage.setItem("mobflow-username", profile.username);
        const savedPermissions = Array.isArray(profile.permissions) ? profile.permissions : (profile.role === "manager" ? ["PDV", "Conferência", "Validade", "Fiado", "Gerência"] : ["PDV", "Conferência"]);
        const normalizedPermissions = Array.from(new Set(savedPermissions.map((permission: string) => permission === "Conferência" ? "Operações" : permission)));
        sessionStorage.setItem("mobflow-permissions", JSON.stringify(normalizedPermissions));
        // Cache only the minimum authorization context, encrypted by Electron's OS-backed safeStorage.
        // No password, Better Auth cookie, bearer token or session secret is persisted.
        if (!restoredOffline) {
          void window.mobflowDesktop?.cacheAuthorizedSession?.({
            accountId: profile.accountId,
            role: profile.role,
            username: profile.username,
            permissions: normalizedPermissions,
          })?.catch((error) => console.warn("MobFlow Desktop: não foi possível salvar a sessão offline:", error));
        }

        if (profile.role === "pdv") {
          sessionStorage.setItem("mobflow-pdv-authorized", "1");
        }

        localStorage.setItem("mobflow-authenticated", "1");
        if (restoredOffline) {
          sessionStorage.setItem("mobflow-desktop-offline", "1");
          await hydrateStoreOffline(profile.accountId);
        } else {
          sessionStorage.removeItem("mobflow-desktop-offline");
          try {
            await hydrateStore();
          } catch (error) {
            console.error("MobFlow: falha ao carregar os dados da conta", error);
          }
        }

        if (active) {
          const firstSetupPending = sessionStorage.getItem("mobflow-first-manager-setup") === "1";
          setAuthenticated(true);
          setUserLoginRequired(!restoredOffline && profile.role === "manager" && !firstSetupPending);
          setCheckingSession(false);
          if (firstSetupPending && profile.role === "manager") {
            void router.navigate({ to: "/gerencia" });
          } else if (profile.role === "pdv" && router.state.location.pathname === "/") {
            const userPermissions = Array.isArray(profile.permissions) ? profile.permissions.map((permission: string) => permission === "Conferência" ? "Operações" : permission) : ["PDV", "Operações"];
            if (!userPermissions.includes("PDV") && userPermissions.includes("Operações")) void router.navigate({ to: "/operacoes" });
          }
        }
      } catch (error) {
        console.error("MobFlow: falha ao inicializar a sessão", error);
        if (active) {
          setAuthenticated(false);
          setCheckingSession(false);
        }
      }
    };

    void bootstrap();
    return () => { active = false; };
  }, []);

  if (checkingSession) {
    const savedDarkTheme = typeof window !== "undefined" && localStorage.getItem("mobflow-theme") === "dark";
    return <div className={`${savedDarkTheme ? "dark " : ""}min-h-screen bg-background grid place-items-center`}><div className="font-mono text-sm text-muted-foreground">Carregando...</div></div>;
  }

  // Páginas públicas precisam funcionar sem sessão para divulgação e recuperação de acesso.
  if (["/recuperar-senha", "/saiba-mais"].includes(router.state.location.pathname)) {
    return (
      <QueryClientProvider client={queryClient}>
        <Outlet />
      </QueryClientProvider>
    );
  }

  if (!authenticated) {
    return (
      <LoginScreen
        mode="empresa"
        onLogin={async (options) => {
          const role = sessionStorage.getItem("mobflow-role");
          await hydrateStore();
          setAuthenticated(true);
          if (options?.firstManagerLogin) {
            setUserLoginRequired(false);
            await router.navigate({ to: "/gerencia" });
          } else {
            setUserLoginRequired(role === "manager");
            if (role === "pdv") {
              let permissions: string[] = [];
              try { permissions = JSON.parse(sessionStorage.getItem("mobflow-permissions") || "[]"); } catch { permissions = []; }
              if (!permissions.includes("PDV") && permissions.includes("Operações")) await router.navigate({ to: "/operacoes" });
            }
          }
        }}
      />
    );
  }

  if (userLoginRequired) {
    return <LoginScreen mode="pdv" onLogin={() => setUserLoginRequired(false)} />;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <><Outlet />{showRouteLoading && <RouteLoadingBar />}</>
    </QueryClientProvider>
  );
}
