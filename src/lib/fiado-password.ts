export async function verifyFiadoPassword(password: string): Promise<void> {
  const username = typeof window !== "undefined" ? sessionStorage.getItem("mobflow-username")?.trim() ?? "" : "";
  const cnpj = typeof window !== "undefined" ? (localStorage.getItem("mobflow-company-cnpj") ?? "").replace(/\D/g, "") : "";
  if (!username) throw new Error("Entre com um usuário do PDV para confirmar o recebimento.");
  if (!password) throw new Error("Informe sua senha para confirmar.");
  if (cnpj.length !== 14) throw new Error("Não foi possível identificar o CNPJ desta empresa. Entre novamente e tente de novo.");
  const response = await fetch("/api/mobflow/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ username, password, cnpj, expectedRole: "pdv" }),
  });
  const data = await response.json().catch(() => ({})) as { ok?: boolean; profile?: { role?: string } };
  if (!response.ok || data.ok !== true || data.profile?.role !== "pdv") {
    throw new Error("Senha incorreta ou usuário do PDV inválido.");
  }
}
