import { supabase } from "@/lib/supabase";
import { isBetterAuthEnabled } from "@/lib/auth-client";

export async function verifyManagerPassword(password: string): Promise<{ ok: boolean; error?: string }> {
  try {
    if (isBetterAuthEnabled) {
      const response = await fetch("/api/mobflow/reauth-manager", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ password }),
      });
      const data = await response.json().catch(() => ({}));
      return response.ok && data?.ok
        ? { ok: true }
        : { ok: false, error: String(data?.error || "Senha da gerência incorreta.") };
    }

    const { data, error } = await supabase.functions.invoke("mobflow-reauth-manager", {
      body: { password },
    });

    if (!error && data?.ok) return { ok: true };

    let message = "";
    try {
      message = String((error as { context?: Response })?.context
        ? ((await (error as { context: Response }).context.json())?.error ?? "")
        : "");
    } catch {}

    return { ok: false, error: message || data?.error || "Senha da gerência incorreta." };
  } catch {
    return { ok: false, error: "Não foi possível validar a senha da gerência." };
  }
}
