import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Sessão necessária." }, 401);

    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!url || !serviceKey || !anonKey) return json({ error: "Serviço indisponível." }, 503);

    const authClient = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: userData, error: userError } = await authClient.auth.getUser(token);
    if (userError || !userData.user) return json({ error: "Sessão inválida." }, 401);

    const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: profile, error: profileError } = await admin.from("profiles")
      .select("id,role,active").eq("id", userData.user.id).maybeSingle();
    if (profileError || !profile || profile.role !== "admin" || !profile.active) {
      return json({ error: "Acesso administrativo não autorizado." }, 403);
    }

    const body = await req.json();
    if (body.action === "get_payment_settings") {
      const { data, error } = await admin.from("mobflow_payment_settings")
        .select("pix_key,recipient_name,recipient_city,monthly_price").eq("id", true).maybeSingle();
      if (error) return json({ error: "Não foi possível carregar as configurações Pix." }, 500);
      return json({ ok: true, settings: data ?? { pix_key: "", recipient_name: "MOBFLOW", recipient_city: "CAPAO BONITO", monthly_price: 79.90 } });
    }

    if (body.action === "save_payment_settings") {
      const pixKey = String(body.pixKey ?? "").trim();
      const recipientName = String(body.recipientName ?? "").trim().replace(/[^a-zA-Z0-9 .&-]/g, "").slice(0, 25).toUpperCase();
      const recipientCity = String(body.recipientCity ?? "").trim().replace(/[^a-zA-Z0-9 .-]/g, "").slice(0, 15).toUpperCase();
      const monthlyPrice = Number(body.monthlyPrice);
      if (!pixKey || pixKey.length < 3 || pixKey.length > 77) return json({ error: "Informe uma chave Pix válida com até 77 caracteres." }, 400);
      if (!recipientName || !recipientCity || !Number.isFinite(monthlyPrice) || monthlyPrice <= 0 || monthlyPrice > 999999.99) {
        return json({ error: "Confira o nome do recebedor, cidade e valor mensal." }, 400);
      }
      const { data, error } = await admin.from("mobflow_payment_settings").upsert({
        id: true, pix_key: pixKey, recipient_name: recipientName, recipient_city: recipientCity,
        monthly_price: monthlyPrice, updated_at: new Date().toISOString(),
      }, { onConflict: "id" }).select("pix_key,recipient_name,recipient_city,monthly_price").single();
      if (error) return json({ error: "Não foi possível salvar as configurações Pix." }, 500);
      return json({ ok: true, settings: data });
    }

    if (body.action === "list") {
      const { data, error } = await admin.from("companies")
        .select("account_id,company_name,cnpj,username,email,phone,plan_code,monthly_price,subscription_status,payment_method,created_at,payment_confirmed_at,payment_notes,payment_proof_path,payment_submitted_at")
        .order("created_at", { ascending: false });
      if (error) return json({ error: "Não foi possível carregar as assinaturas." }, 500);
      const companiesWithProof = await Promise.all((data ?? []).map(async (company) => {
        if (!company.payment_proof_path) return { ...company, payment_proof_url: null };
        const { data: signed, error: signedError } = await admin.storage.from("mobflow-payment-proofs")
          .createSignedUrl(company.payment_proof_path, 60 * 60);
        return { ...company, payment_proof_url: signedError ? null : signed?.signedUrl ?? null };
      }));

      // Include existing active accounts created before the subscription registry existed.
      const { data: allowedUsers, error: allowlistError } = await admin.from("account_allowlist")
        .select("username,cnpj").eq("active", true);
      if (allowlistError) return json({ error: "Não foi possível carregar as contas ativas." }, 500);

      const { data: profiles, error: profilesError } = await admin.from("profiles")
        .select("username,cnpj,account_id,role,active,display_name")
        .eq("active", true).neq("role", "admin");
      if (profilesError) return json({ error: "Não foi possível carregar as contas ativas." }, 500);

      const allowedNames = new Set((allowedUsers ?? []).map((item) => String(item.username).toUpperCase()));
      const registeredAccountIds = new Set((data ?? []).map((item) => item.account_id));
      const grouped = new Map<string, { account_id: string; company_name: string; cnpj: string; usernames: Set<string>; user_count: number }>();
      for (const profile of profiles ?? []) {
        const username = String(profile.username ?? "").toUpperCase();
        const accountId = String(profile.account_id ?? "");
        if (!username || !accountId || !allowedNames.has(username) || registeredAccountIds.has(accountId)) continue;
        const existing = grouped.get(accountId);
        if (existing) {
          existing.usernames.add(username);
          existing.user_count += 1;
          if (profile.role === "manager" && profile.display_name) existing.company_name = profile.display_name;
        } else {
          grouped.set(accountId, {
            account_id: accountId,
            company_name: profile.role === "manager" && profile.display_name ? profile.display_name : (profile.display_name || username),
            cnpj: String(profile.cnpj ?? ""),
            usernames: new Set([username]),
            user_count: 1,
          });
        }
      }
      const activeAccounts = Array.from(grouped.values()).map((item) => ({
        account_id: item.account_id,
        company_name: item.company_name,
        cnpj: item.cnpj,
        usernames: Array.from(item.usernames).sort(),
        user_count: item.user_count,
        status: "active",
      }));
      return json({ ok: true, companies: companiesWithProof, activeAccounts });
    }


    if (body.action === "delete_account") {
      const accountId = String(body.accountId ?? "").trim();
      if (!accountId || accountId.length > 100) return json({ error: "Conta não informada." }, 400);

      const [{ data: company, error: companyError }, { data: accountProfiles, error: profilesError }] = await Promise.all([
        admin.from("companies").select("account_id,company_name,cnpj,username,payment_proof_path").eq("account_id", accountId).maybeSingle(),
        admin.from("profiles").select("id,username,cnpj,role,account_id").eq("account_id", accountId),
      ]);
      if (companyError || profilesError) return json({ error: "Não foi possível validar a conta para exclusão." }, 500);

      const profiles = accountProfiles ?? [];
      if (!company && profiles.length === 0) return json({ error: "Conta não encontrada ou já excluída." }, 404);
      if (profiles.some((profile) => profile.role === "admin")) {
        return json({ error: "Por segurança, contas administrativas não podem ser excluídas por esta opção." }, 403);
      }

      const accountCnpj = String(company?.cnpj ?? profiles.find((profile) => profile.cnpj)?.cnpj ?? "");
      const usernames = [...new Set(profiles.map((profile) => String(profile.username ?? "").trim()).filter(Boolean))];
      const authUserIds = [...new Set(profiles.map((profile) => String(profile.id ?? "")).filter(Boolean))];

      const authDeleteErrors: string[] = [];
      for (const userId of authUserIds) {
        const { error: deleteUserError } = await admin.auth.admin.deleteUser(userId);
        if (deleteUserError) authDeleteErrors.push(userId);
      }
      if (authDeleteErrors.length) {
        console.error("Account deletion incomplete; auth users could not be deleted:", authDeleteErrors);
        return json({ error: "A exclusão ficou incompleta porque não foi possível remover todos os logins. Nenhum sucesso foi informado; verifique esta conta e tente novamente." }, 500);
      }

      const cleanupResults = await Promise.all([
        admin.from("app_state").delete().eq("owner_id", accountId),
        admin.from("manager_security_by_account").delete().eq("account_id", accountId),
        admin.from("profiles").delete().eq("account_id", accountId),
        admin.from("companies").delete().eq("account_id", accountId),
      ]);
      if (cleanupResults.some((result) => result.error)) {
        console.error("Account deletion database cleanup failed:", cleanupResults.map((result) => result.error?.message).filter(Boolean));
        return json({ error: "Os logins foram removidos, mas parte dos dados da conta não pôde ser apagada. Revise a conta no banco antes de tentar novamente." }, 500);
      }

      if (usernames.length && accountCnpj) {
        const { error: allowlistError } = await admin.from("account_allowlist")
          .delete().in("username", usernames).eq("cnpj", accountCnpj);
        if (allowlistError) {
          console.error("Account allowlist cleanup failed:", allowlistError.message);
          return json({ error: "Os logins e dados principais foram removidos, mas não foi possível apagar todas as autorizações. Revise a lista de autorizações." }, 500);
        }
      }

      if (company?.payment_proof_path) {
        const { error: proofError } = await admin.storage.from("mobflow-payment-proofs").remove([company.payment_proof_path]);
        if (proofError) {
          console.error("Payment proof cleanup failed:", proofError.message);
          return json({ error: "A conta foi removida, mas o comprovante de pagamento não pôde ser apagado do armazenamento." }, 500);
        }
      }

      const [{ count: remainingState, error: verifyStateError }, { count: remainingProfiles, error: verifyProfilesError }, { count: remainingCompany, error: verifyCompanyError }] = await Promise.all([
        admin.from("app_state").select("owner_id", { count: "exact", head: true }).eq("owner_id", accountId),
        admin.from("profiles").select("id", { count: "exact", head: true }).eq("account_id", accountId),
        admin.from("companies").select("account_id", { count: "exact", head: true }).eq("account_id", accountId),
      ]);
      if (verifyStateError || verifyProfilesError || verifyCompanyError || (remainingState ?? 0) > 0 || (remainingProfiles ?? 0) > 0 || (remainingCompany ?? 0) > 0) {
        return json({ error: "A verificação final não confirmou a exclusão completa. Revise os dados desta conta." }, 500);
      }

      return json({ ok: true, deleted: true, accountId });
    }

    if (body.action === "update") {
      const accountId = String(body.accountId ?? "");
      const status = String(body.status ?? "");
      const note = typeof body.note === "string" ? body.note.trim().slice(0, 1000) : "";
      const allowedStatuses = ["pending_payment", "active", "past_due", "suspended", "cancelled"];
      if (!accountId || !allowedStatuses.includes(status)) return json({ error: "Dados de atualização inválidos." }, 400);

      const updates: Record<string, unknown> = {
        subscription_status: status,
        updated_at: new Date().toISOString(),
        payment_notes: note || null,
      };
      if (status === "active") {
        updates.payment_confirmed_at = new Date().toISOString();
        updates.payment_confirmed_by = userData.user.id;
      } else if (status === "pending_payment") {
        updates.payment_confirmed_at = null;
        updates.payment_confirmed_by = null;
      }
      const { data, error } = await admin.from("companies").update(updates)
        .eq("account_id", accountId)
        .select("account_id,company_name,subscription_status,payment_confirmed_at,payment_notes")
        .maybeSingle();
      if (error) return json({ error: "Não foi possível atualizar a assinatura." }, 500);
      if (!data) return json({ error: "Empresa não encontrada." }, 404);
      return json({ ok: true, company: data });
    }

    return json({ error: "Ação inválida." }, 400);
  } catch (error) {
    console.error("mobflow-admin-subscriptions error", error);
    return json({ error: "Não foi possível concluir a operação." }, 500);
  }
});