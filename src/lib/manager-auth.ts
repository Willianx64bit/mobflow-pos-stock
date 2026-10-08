import { supabase } from "@/lib/supabase";

export async function verifyManagerPassword(password: string): Promise<{ ok: boolean; error?: string }> {
  try {
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
