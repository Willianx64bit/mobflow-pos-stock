export async function verifyManagerPassword(password: string): Promise<{ ok: boolean; error?: string; retryAfterSeconds?: number }> {
  try {
    const response = await fetch("/api/mobflow/reauth-manager", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ password }),
    });
    const data = await response.json().catch(() => ({}));
    const retryAfterSeconds = Number(data?.retryAfterSeconds);
    return response.ok && data?.ok
      ? { ok: true }
      : {
          ok: false,
          error: String(data?.error || "Senha da gerência incorreta."),
          ...(Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? { retryAfterSeconds } : {}),
        };
  } catch {
    return { ok: false, error: "Não foi possível validar a senha da gerência." };
  }
}
