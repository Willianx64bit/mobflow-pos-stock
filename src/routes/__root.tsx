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
      { rel: "icon", href: "/mobflow-icon.svg", type: "image/svg+xml" },
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

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();
  const [checkingSession, setCheckingSession] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [userLoginRequired, setUserLoginRequired] = useState(false);

  useEffect(() => {
    const onAuthChanged = () => { setAuthenticated(false); setUserLoginRequired(false); };
    const onUserLogout = () => setUserLoginRequired(true);
    window.addEventListener("mobflow-auth-changed", onAuthChanged);
    window.addEventListener("mobflow-user-logout", onUserLogout);
    return () => { window.removeEventListener("mobflow-auth-changed", onAuthChanged); window.removeEventListener("mobflow-user-logout", onUserLogout); };
  }, []);

  useEffect(() => {
    let active = true;
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

        if (!profile || profile.active === false || profile.role === "admin") {
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

        sessionStorage.setItem("mobflow-role", profile.role);
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
          const firstSetupPending = sessionStorage.getItem("mobflow-first-manager-setup") === "1";
          setAuthenticated(true);
          setUserLoginRequired(profile.role === "manager" && !firstSetupPending);
          setCheckingSession(false);
          if (firstSetupPending && profile.role === "manager") void router.navigate({ to: "/gerencia" });
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
      <Outlet />
    </QueryClientProvider>
  );
}
