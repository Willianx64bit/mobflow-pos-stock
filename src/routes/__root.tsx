import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { supabase } from "@/lib/supabase";
import { hydrateStore } from "@/lib/store";
import { LoginScreen } from "@/components/LoginScreen";

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

  useEffect(() => {
    const key = "mobflow-route-auto-retry";
    if (sessionStorage.getItem(key) !== "1") {
      sessionStorage.setItem(key, "1");
      window.location.reload();
    }
  }, []);
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
      { title: "MobFlow — PDV e Estoque" },
      { name: "description", content: "MobFlow: ponto de venda rápido com controle de estoque." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" },
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
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
      <head><HeadContent /></head>
      <body>{children}<Scripts /></body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const [checkingSession, setCheckingSession] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    let active = true;
    const retryTimer = window.setTimeout(() => sessionStorage.removeItem("mobflow-route-auto-retry"), 5000);

    const bootstrap = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const session = data.session;

        if (!session) {
          localStorage.removeItem("mobflow-authenticated");
          sessionStorage.removeItem("mobflow-role");
          sessionStorage.removeItem("mobflow-username");
          sessionStorage.removeItem("mobflow-pdv-authorized");
          if (active) {
            setAuthenticated(false);
            setCheckingSession(false);
          }
          return;
        }

        const { data: profile } = await supabase
          .from("profiles")
          .select("role,username,active")
          .eq("id", session.user.id)
          .maybeSingle();

        if (!profile || profile.active === false) {
          await supabase.auth.signOut();
          localStorage.removeItem("mobflow-authenticated");
          sessionStorage.removeItem("mobflow-role");
          sessionStorage.removeItem("mobflow-username");
          sessionStorage.removeItem("mobflow-pdv-authorized");
          if (active) {
            setAuthenticated(false);
            setCheckingSession(false);
          }
          return;
        }

        sessionStorage.setItem("mobflow-role", profile.role === "manager" ? "manager" : "pdv");
        sessionStorage.setItem("mobflow-username", profile.username);

        if (profile.role === "pdv") {
          sessionStorage.setItem("mobflow-pdv-authorized", "1");
        }

        localStorage.setItem("mobflow-authenticated", "1");
        try {
          await hydrateStore();
        } catch (error) {
          console.error("MobFlow: falha ao carregar os dados da conta", error);
        }

        if (active) {
          setAuthenticated(true);
          setCheckingSession(false);
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
    return () => { active = false; window.clearTimeout(retryTimer); };
  }, []);

  if (checkingSession) {
    return <div className="min-h-screen bg-background grid place-items-center"><div className="font-mono text-sm text-muted-foreground">Carregando...</div></div>;
  }

  if (!authenticated) {
    return (
      <LoginScreen
        mode="empresa"
        onLogin={async () => {
          await hydrateStore();
          setAuthenticated(true);
        }}
      />
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
    </QueryClientProvider>
  );
}
