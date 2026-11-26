import { isValidOfflineFiadoSession, type CachedOfflinePdvSession } from "@/lib/offline-fiado-auth";

type DesktopFiadoAuth = {
  getCachedAuthorizedSession?: () => Promise<CachedOfflinePdvSession | null>;
  verifyCachedLoginPassword?: (value: { cnpj: string; username: string; role: "pdv"; password: string }) => Promise<boolean>;
};

async function verifyOfflineFiadoPassword(
  desktop: DesktopFiadoAuth | undefined,
  accountId: string,
  username: string,
  cnpj: string,
  password: string,
) {
  if (!desktop?.getCachedAuthorizedSession || !desktop.verifyCachedLoginPassword) {
    throw new Error("A validação segura offline não está disponível nesta versão do EXE. Conecte-se à internet.");
  }
  const cached = await desktop.getCachedAuthorizedSession().catch(() => null);
  if (!isValidOfflineFiadoSession(cached, accountId, username)) {
    throw new Error("A sessão offline deste operador ou desta empresa expirou. Conecte-se e entre novamente.");
  }
  const valid = await desktop.verifyCachedLoginPassword({ cnpj, username, role: "pdv", password });
  if (!valid) {
    throw new Error("Senha incorreta ou não salva neste computador. Conecte-se à internet e entre novamente para autorizar o recebimento offline.");
  }
}

export async function verifyFiadoPassword(password: string): Promise<void> {
  const username = typeof window !== "undefined" ? sessionStorage.getItem("mobflow-username")?.trim() ?? "" : "";
  const cnpj = typeof window !== "undefined" ? (localStorage.getItem("mobflow-company-cnpj") ?? "").replace(/\D/g, "") : "";
  const accountId = typeof window !== "undefined" ? localStorage.getItem("mobflow:owner") ?? "" : "";
  if (!username) throw new Error("Entre com um usuário do PDV para confirmar o recebimento.");
  if (!password) throw new Error("Informe sua senha para confirmar.");
  if (cnpj.length !== 14) throw new Error("Não foi possível identificar o CNPJ desta empresa. Entre novamente e tente de novo.");

  const desktop = typeof window !== "undefined"
    ? (window as Window & { mobflowDesktop?: DesktopFiadoAuth }).mobflowDesktop
    : undefined;
  const offline = typeof navigator !== "undefined" && !navigator.onLine ||
    (typeof window !== "undefined" && sessionStorage.getItem("mobflow-desktop-offline") === "1");

  if (desktop && offline) {
    await verifyOfflineFiadoPassword(desktop, accountId, username, cnpj, password);
    return;
  }

  let response: Response;
  try {
    response = await fetch("/api/mobflow/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ username, password, cnpj, expectedRole: "pdv" }),
    });
  } catch {
    if (desktop) {
      await verifyOfflineFiadoPassword(desktop, accountId, username, cnpj, password);
      return;
    }
    throw new Error("Não foi possível validar sua senha. Verifique a conexão e tente novamente.");
  }

  const data = await response.json().catch(() => ({})) as { ok?: boolean; profile?: { role?: string }; error?: string };
  if (response.ok && data.ok === true && data.profile?.role === "pdv") return;
  if (desktop && (response.status >= 500 || response.headers.get("x-mobflow-local-proxy-error") === "1")) {
    await verifyOfflineFiadoPassword(desktop, accountId, username, cnpj, password);
    return;
  }
  throw new Error("Senha incorreta ou usuário do PDV inválido.");
}
