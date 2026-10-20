import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);
  try {
    const { username, password, cnpj, expectedRole: requestedRole } = await req.json();
    const cleanUsername = String(username ?? "").trim().toUpperCase();
    const cleanPassword = String(password ?? "");
    const cleanCnpj = String(cnpj ?? "").replace(/\D/g, "");
    const expectedRole = requestedRole === "pdv" || (!requestedRole && !cleanCnpj) ? "pdv" : "manager";
    if (!cleanUsername || cleanPassword.length < 6) return json({ error: "Usuário ou senha inválido." }, 400);
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const client = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const email = cleanUsername.toLowerCase().replace(/[^a-z0-9._-]/g, "-") + "@accounts.mobflow.local";
    const { data: profile, error: profileError } = await admin.from("profiles").select("id,username,cnpj,account_id,role,active,display_name,permissions").eq("username", cleanUsername).maybeSingle();
    if (profileError) return json({ error: "Não foi possível validar a conta." }, 500);

    const hasManagementAccess = profile?.role === "manager" ||
      (profile?.role === "pdv" && Array.isArray(profile.permissions) && profile.permissions.includes("Gerência"));

    // Any account with management access must have an active subscription.
    if (hasManagementAccess && profile?.account_id) {
      const { data: company, error: companyError } = await admin.from("companies")
        .select("subscription_status").eq("account_id", profile.account_id).maybeSingle();
      if (companyError) return json({ error: "Não foi possível verificar a assinatura." }, 500);
      if (company && company.subscription_status !== "active") {
        return json({ error: "Sua conta foi criada, mas a assinatura ainda aguarda confirmação e ativação. Entre em contato com o MobFlow para liberar o acesso." }, 403);
      }
    }

    let firstManagerLogin = false;
    if (profile) {
      if (!profile.active) return json({ error: "Usuário ou acesso inválido." }, 401);
      if (expectedRole === "pdv" && profile.role !== "pdv") return json({ error: "Esse usuário não é um usuário do PDV. Use um usuário criado em Configurações → Usuários do PDV." }, 403);
      if (expectedRole === "pdv" && cleanCnpj.length !== 14) return json({ error: "Informe o CNPJ da empresa para validar o acesso do PDV." }, 400);
      if (expectedRole === "pdv" && profile.cnpj !== cleanCnpj) return json({ error: "Esse usuário do PDV pertence a outra empresa." }, 403);
      if (expectedRole === "manager" && !hasManagementAccess) return json({ error: "Esse usuário não tem permissão de Gerência." }, 403);
      if (expectedRole === "manager" && profile.cnpj !== cleanCnpj) return json({ error: "CNPJ da empresa inválido." }, 401);
      if (expectedRole === "manager" && profile.account_id) {
        const { data: managerSecurity, error: managerSecurityError } = await admin.from("manager_security_by_account").select("account_id").eq("account_id", profile.account_id).maybeSingle();
        const { data: activePdvUsers, error: pdvUsersError } = await admin.from("profiles").select("id").eq("account_id", profile.account_id).eq("role", "pdv").eq("active", true).limit(1);
        if (managerSecurityError || pdvUsersError) return json({ error: "Não foi possível verificar a configuração inicial da empresa." }, 500);
        firstManagerLogin = !managerSecurity && !activePdvUsers?.length;
      }
    } else {
      if (expectedRole !== "manager") return json({ error: "Usuário do PDV não encontrado. Cadastre-o primeiro pela gerência da empresa." }, 401);
      if (cleanCnpj.length !== 14) return json({ error: "Para acessar a gerência, informe o CNPJ da empresa." }, 400);
      const { data: allowed } = await admin.from("account_allowlist").select("username,cnpj,active").eq("username", cleanUsername).eq("cnpj", cleanCnpj).eq("active", true).maybeSingle();
      if (!allowed) return json({ error: "Usuário não autorizado." }, 401);
      const { data: existingCompanyProfiles, error: existingProfilesError } = await admin.from("profiles").select("id").eq("cnpj", cleanCnpj).limit(1);
      if (existingProfilesError) return json({ error: "Não foi possível verificar os usuários da empresa." }, 500);
      const isFirstCompanyUser = !existingCompanyProfiles?.length;
      const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password: cleanPassword, email_confirm: true, user_metadata: { username: cleanUsername, cnpj: cleanCnpj, role: "manager", display_name: cleanUsername } });
      if (createError || !created.user) { console.error("createUser failed", createError); return json({ error: createError?.message ?? "Não foi possível criar a conta." }, 400); }
      const { error: insertError } = await admin.from("profiles").upsert({ id: created.user.id, username: cleanUsername, cnpj: cleanCnpj, account_id: created.user.id, role: "manager", active: true, display_name: cleanUsername, permissions: ["PDV", "Conferência", "Validade", "Fiado", "Gerência"] }, { onConflict: "id" });
      if (insertError) { await admin.auth.admin.deleteUser(created.user.id); return json({ error: "Não foi possível preparar a conta." }, 500); }
      firstManagerLogin = isFirstCompanyUser;
    }
    const { data, error } = await client.auth.signInWithPassword({ email, password: cleanPassword });
    if (error || !data.session) return json({ error: "Usuário ou senha inválido." }, 401);
    return json({ session: data.session, firstManagerLogin, profile: { username: profile?.username ?? cleanUsername, role: expectedRole === "manager" ? "manager" : (profile?.role ?? "pdv"), account_id: profile?.account_id ?? data.user?.id ?? null, display_name: profile?.display_name ?? cleanUsername, permissions: expectedRole === "manager" ? ["PDV", "Conferência", "Validade", "Fiado", "Gerência"] : (Array.isArray(profile?.permissions) ? profile.permissions : ["PDV", "Conferência"]) } });
  } catch { return json({ error: "Não foi possível entrar agora." }, 500); }
});