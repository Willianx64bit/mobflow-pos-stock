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
import { useEffect, useState, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { LoginScreen } from "../components/LoginScreen";
import { supabase } from "@/lib/supabase";
import { hydrateStore } from "@/lib/store";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
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
      {
        rel: "stylesheet",
        href: appCss,
      },
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
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const [authenticated, setAuthenticated] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [role, setRole] = useState<"manager" | "pdv" | null>(null);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const router = useRouter();

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(async ({ data }) => {
      const hasLoginMarker = localStorage.getItem("mobflow-authenticated") === "1";
      if (data.session && !hasLoginMarker) {
        await supabase.auth.signOut();
        sessionStorage.removeItem("mobflow-role");
        sessionStorage.removeItem("mobflow-username");
        data.session = null;
      }
      if (data.session) {
        const { data: profile } = await supabase.from("profiles").select("role,username").eq("id", data.session.user.id).maybeSingle();
        const nextRole = profile?.role === "manager" ? "manager" : "pdv";
        sessionStorage.setItem("mobflow-role", nextRole);
        if (profile?.username) sessionStorage.setItem("mobflow-username", profile.username);
        setRole(nextRole);
        await hydrateStore();
      } else {
        sessionStorage.removeItem("mobflow-role");
        sessionStorage.removeItem("mobflow-username");
        setRole(null);
      }
      if (active) {
        setAuthenticated(Boolean(data.session));
        setCheckingAuth(false);
      }
    });
    return () => { active = false; };
  }, []);

  const handleLogin = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    const { data: profile } = user ? await supabase.from("profiles").select("role,username").eq("id", user.id).maybeSingle() : { data: null };
    const nextRole = profile?.role === "manager" ? "manager" : "pdv";
    sessionStorage.setItem("mobflow-role", nextRole);
    if (profile?.username) sessionStorage.setItem("mobflow-username", profile.username);
    setRole(nextRole);
    await hydrateStore();
    setAuthenticated(true);
  };

  useEffect(() => {
    if (authenticated && role === "pdv" && pathname !== "/") {
      void router.navigate({ to: "/" });
    }
  }, [authenticated, role, pathname, router]);

  if (checkingAuth) {
    return (
      <QueryClientProvider client={queryClient}>
        <Outlet />
      </QueryClientProvider>
    );
  }

  if (!authenticated) {
    return (
      <QueryClientProvider client={queryClient}>
        <LoginScreen onLogin={handleLogin} />
      </QueryClientProvider>
    );
  }

  if (role === "pdv" && pathname !== "/") {
    return <div className="min-h-screen grid place-items-center bg-background"><div className="rounded-2xl bg-surface ring-1 ring-border px-6 py-5 text-center"><div className="font-semibold text-foreground">Acesso restrito ao PDV</div><div className="mt-1 text-sm text-muted-foreground">Esse usuário não possui acesso administrativo.</div></div></div>;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
    </QueryClientProvider>
  );
}
