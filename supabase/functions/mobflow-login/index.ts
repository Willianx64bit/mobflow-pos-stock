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
    const expectedRole = requestedRole === "admin" ? "admin" : requestedRole === "pdv" || (!requestedRole && !cleanCnpj) ? "pdv" : "manager";
    if (!cleanUsername || cleanPassword.length < 6) return json({ error: "Usuário ou senha inválido." }, 400);
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const client = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const clientIp = (req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || "unknown").split(",")[0].trim().slice(0, 100);
    if (expectedRole === "admin") {
      const { data: guardRows, error: guardError } = await admin.rpc("mobflow_admin_login_guard", {
        p_username: cleanUsername, p_client_ip: clientIp, p_action: "check",
      });
      if (guardError) return json({ error: "Não foi possível validar o acesso administrativo." }, 500);
      const guard = Array.isArray(guardRows) ? guardRows[0] : guardRows;
      if (guard?.locked_until && new Date(guard.locked_until).getTime() > Date.now()) {
        const retryAt = new Date(guard.locked_until).getTime();
        const remainingMinutes = Math.max(1, Math.ceil((retryAt - Date.now()) / 60000));
        return json({ error: `Muitas tentativas. Aguarde ${remainingMinutes} minuto(s) antes de tentar novamente.`, locked: true, retryAfterMinutes: remainingMinutes }, 429);
      }
    }
    const registerAdminFailure = async () => {
      if (expectedRole !== "admin") return null;
      const { data: rows, error: rpcError } = await admin.rpc("mobflow_admin_login_guard", {
        p_username: cleanUsername, p_client_ip: clientIp, p_action: "fail",
      });
      if (rpcError) console.error("admin login attempt tracking failed", rpcError.message);
      return Array.isArray(rows) ? rows[0] : rows;
    };
    const email = cleanUsername.toLowerCase().replace(/[^a-z0-9._-]/g, "-") + "@accounts.mobflow.local";
    const { data: profile, error: profileError } = await admin.from("profiles").select("id,username,cnpj,account_id,role,active,display_name,permissions").eq("username", cleanUsername).maybeSingle();
    if (profileError) return json({ error: "Não foi possível validar a conta." }, 500);

    // Admin access is independently allowlisted; it never creates a paid company or app_state.
    if (expectedRole === "admin") {
      if (cleanCnpj.length !== 14) return json({ error: "CNPJ administrativo inválido." }, 400);
      const { data: allowed, error: allowError } = await admin.from("mobflow_admin_allowlist")
        .select("username,cnpj,active").eq("username", cleanUsername).eq("cnpj", cleanCnpj).eq("active", true).maybeSingle();
      if (allowError) return json({ error: "Não foi possível validar o acesso administrativo." }, 500);
      if (!allowed) { await registerAdminFailure(); return json({ error: "Usuário ou senha inválido." }, 401); }
      let adminProfile = profile;
      if (adminProfile && (adminProfile.role !== "admin" || !adminProfile.active || adminProfile.cnpj !== cleanCnpj)) {
        return json({ error: "Usuário ou senha inválido." }, 401);
      }
      if (!adminProfile) {
        const { data: created, error: createError } = await admin.auth.admin.createUser({
          email, password: cleanPassword, email_confirm: true,
          user_metadata: { username: cleanUsername, cnpj: cleanCnpj, role: "admin", display_name: "Administrador MobFlow" },
        });
        if (createError || !created.user) {
          console.error("admin createUser failed", createError?.message);
          return json({ error: "Não foi possível criar o acesso administrativo. Se o usuário já existe, solicite a regularização do perfil." }, 500);
        }
        const { data: createdProfile, error: insertError } = await admin.from("profiles").insert({
          id: created.user.id, username: cleanUsername, cnpj: cleanCnpj,
          account_id: created.user.id, role: "admin", active: true,
          display_name: "Administrador MobFlow", permissions: ["Assinaturas", "Confirmação de pagamentos"],
        }).select("id,username,cnpj,account_id,role,active,display_name,permissions").single();
        if (insertError || !createdProfile) {
          await admin.auth.admin.deleteUser(created.user.id);
          console.error("admin profile insert failed", insertError?.message);
          return json({ error: "Não foi possível preparar o acesso administrativo." }, 500);
        }
        adminProfile = createdProfile;
      }
      const { data: adminSession, error: adminSignInError } = await client.auth.signInWithPassword({ email, password: cleanPassword });
      if (adminSignInError || !adminSession.session) {\n        const failed = await registerAdminFailure();\n        const lockedUntil = failed?.locked_until;\n        if (lockedUntil && new Date(lockedUntil).getTime() > Date.now()) return json({ error: "Você atingiu 3 tentativas. Aguarde 30 minutos para tentar novamente.", locked: true, retryAfterMinutes: 30 }, 429);\n        return json({ error: "Usuário ou senha inválido.", attemptsRemaining: Math.max(0, 3 - Number(failed?.attempts ?? 0)) }, 401);\n      }\n      await admin.rpc("mobflow_admin_login_guard", { p_username: cleanUsername, p_client_ip: clientIp, p_action: "reset" });\n      return json({ session: adminSession.session, profile: {
        username: adminProfile.username, role: "admin", account_id: adminProfile.account_id,
        display_name: adminProfile.display_name, permissions: ["Assinaturas", "Confirmação de pagamentos"],
      } });
    }

    // New paid accounts must be activated by the subscription owner before login.
    // Legacy accounts without a companies row continue to work as before.
    if (profile?.role === "manager" && profile.account_id) {
      const { data: company, error: companyError } = await admin.from("companies")
        .select("subscription_status").eq("account_id", profile.account_id).maybeSingle();
      if (companyError) return json({ error: "Não foi possível verificar a assinatura." }, 500);
      if (company && company.subscription_status !== "active") {
        return json({ error: "Sua conta foi criada, mas a assinatura ainda aguarda confirmação e ativação. Entre em contato com o MobFlow para liberar o acesso." }, 403);
      }
    }

    if (profile) {
      if (!profile.active) return json({ error: "Usuário ou acesso inválido." }, 401);
      if (expectedRole === "pdv" && profile.role !== "pdv") return json({ error: "Esse usuário não é um usuário do PDV. Use um usuário criado em Configurações → Usuários do PDV." }, 403);
      if (expectedRole === "pdv" && cleanCnpj.length !== 14) return json({ error: "Informe o CNPJ da empresa para validar o acesso do PDV." }, 400);
      if (expectedRole === "pdv" && profile.cnpj !== cleanCnpj) return json({ error: "Esse usuário do PDV pertence a outra empresa." }, 403);
      if (expectedRole === "manager" && profile.role !== "manager") return json({ error: "Esse usuário é do PDV e não pode entrar como gerente." }, 403);
      if (profile.role === "manager" && profile.cnpj !== cleanCnpj) return json({ error: "CNPJ da empresa inválido." }, 401);
    } else {
      if (expectedRole !== "manager") return json({ error: "Usuário do PDV não encontrado. Cadastre-o primeiro pela gerência da empresa." }, 401);
      if (cleanCnpj.length !== 14) return json({ error: "Para acessar a gerência, informe o CNPJ da empresa." }, 400);
      const { data: allowed } = await admin.from("account_allowlist").select("username,cnpj,active").eq("username", cleanUsername).eq("cnpj", cleanCnpj).eq("active", true).maybeSingle();
      if (!allowed) return json({ error: "Usuário não autorizado." }, 401);
      const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password: cleanPassword, email_confirm: true, user_metadata: { username: cleanUsername, cnpj: cleanCnpj, role: "manager", display_name: cleanUsername } });
      if (createError || !created.user) { console.error("createUser failed", createError); return json({ error: createError?.message ?? "Não foi possível criar a conta." }, 400); }
      const { error: insertError } = await admin.from("profiles").upsert({ id: created.user.id, username: cleanUsername, cnpj: cleanCnpj, account_id: created.user.id, role: "manager", active: true, display_name: cleanUsername, permissions: ["PDV", "Conferência", "Validade", "Fiado", "Gerência"] }, { onConflict: "id" });
      if (insertError) { await admin.auth.admin.deleteUser(created.user.id); return json({ error: "Não foi possível preparar a conta." }, 500); }
    }
    const { data, error } = await client.auth.signInWithPassword({ email, password: cleanPassword });
    if (error || !data.session) return json({ error: "Usuário ou senha inválido." }, 401);
    return json({ session: data.session, profile: { username: profile?.username ?? cleanUsername, role: profile?.role ?? "manager", account_id: profile?.account_id ?? data.user?.id ?? null, display_name: profile?.display_name ?? cleanUsername, permissions: profile?.role === "manager" ? ["PDV", "Conferência", "Validade", "Fiado", "Gerência"] : (Array.isArray(profile?.permissions) ? profile.permissions : ["PDV", "Conferência"]) } });
  } catch { return json({ error: "Não foi possível entrar agora." }, 500); }
});