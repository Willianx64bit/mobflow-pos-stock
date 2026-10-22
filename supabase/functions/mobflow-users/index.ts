import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ error: "Sessão não encontrada." }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const client = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

    const { data: authData, error: authError } = await client.auth.getUser(token);
    if (authError || !authData.user) return json({ error: "Sessão inválida." }, 401);

    const { data: manager, error: managerError } = await admin
      .from("profiles")
      .select("id,username,cnpj,account_id,role,active,permissions")
      .eq("id", authData.user.id)
      .maybeSingle();

    const canManageUsers = manager?.role === "manager" ||
      (manager?.role === "pdv" && Array.isArray(manager.permissions) && manager.permissions.includes("Gerência"));

    if (managerError || !manager || !manager.active || !canManageUsers) {
      return json({ error: "A conta precisa ter permissão de Gerência para acessar usuários do PDV." }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "list");

    if (action === "reset_application") {
      // Destructive operation: require the manager password again on the server.
      const managerPassword = String(body.managerPassword ?? "");
      if (!managerPassword) return json({ error: "Informe a senha da gerência." }, 400);
      if (manager.role !== "manager") return json({ error: "Somente o login principal da Gerência pode zerar a aplicação." }, 403);

      const { data: security, error: securityError } = await admin
        .from("manager_security_by_account")
        .select("password_hash")
        .eq("account_id", manager.account_id)
        .maybeSingle();
      if (securityError || !security?.password_hash) return json({ error: "Não foi possível validar a senha da gerência." }, 500);
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(managerPassword));
      const submittedHash = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
      if (submittedHash !== security.password_hash) return json({ error: "Senha da gerência incorreta." }, 401);

      // Empty the company's single source-of-truth row in Supabase. Product photos
      // and logo are currently stored inline in this JSON state, so this removes
      // their stored data as well, without touching any other account.
      const emptyState = {
        products: [], cart: [], sales: [], conferences: [], receiving: [],
        manualExpiries: [], promotions: [], suppliers: [], settings: { companyName: "" }
      };
      const { data: savedState, error: stateError } = await admin
        .from("app_state")
        .upsert({ owner_id: manager.account_id, state: emptyState, updated_at: new Date().toISOString() }, { onConflict: "owner_id" })
        .select("owner_id,updated_at")
        .maybeSingle();
      if (stateError || !savedState) return json({ error: "Não foi possível confirmar a limpeza dos dados no Supabase. Nenhum sucesso foi informado." }, 500);

      const { data: users, error: listError } = await admin
        .from("profiles").select("id,username")
        .eq("account_id", manager.account_id).eq("role", "pdv");
      if (listError) return json({ error: "Os dados foram limpos, mas não foi possível listar os usuários do PDV para exclusão. Atualize e tente novamente." }, 500);

      let deleted = 0;
      for (const user of users ?? []) {
        const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
        if (deleteError) return json({ error: "Os dados foram limpos, mas houve falha ao excluir um usuário do PDV. Revise a lista de usuários." }, 500);
        const { error: allowlistError } = await admin.from("account_allowlist")
          .delete().eq("username", user.username).eq("cnpj", manager.cnpj);
        if (allowlistError) return json({ error: "Os dados foram limpos, mas não foi possível remover o cadastro de autorização de um usuário. Revise a lista de usuários." }, 500);
        deleted++;
      }

      // Confirm server-side that the persisted application state is empty.
      const { data: verifyState, error: verifyError } = await admin
        .from("app_state").select("state,updated_at").eq("owner_id", manager.account_id).maybeSingle();
      const state = verifyState?.state as Record<string, unknown> | undefined;
      const empty = !verifyError && !!state &&
        ["products","cart","sales","conferences","receiving","manualExpiries","promotions","suppliers"]
          .every((key) => Array.isArray(state[key]) && (state[key] as unknown[]).length === 0) &&
        !!state.settings && typeof state.settings === "object" &&
        !(state.settings as Record<string, unknown>).pixKey &&
        !(state.settings as Record<string, unknown>).companyLogo;
      if (!empty) return json({ error: "A limpeza foi solicitada, mas a verificação final no Supabase não confirmou todos os dados vazios." }, 500);

      return json({ ok: true, deleted, cloudCleared: true, updatedAt: verifyState?.updated_at });
    }

    if (action === "delete_all_pdv") {
      const { data: users, error: listError } = await admin
        .from("profiles")
        .select("id,username")
        .eq("account_id", manager.account_id)
        .eq("role", "pdv");
      if (listError) return json({ error: "Não foi possível localizar os usuários do PDV desta empresa." }, 500);

      let deleted = 0;
      for (const user of users ?? []) {
        const { error: allowlistError } = await admin
          .from("account_allowlist")
          .update({ active: false })
          .eq("username", user.username)
          .eq("cnpj", manager.cnpj);
        if (allowlistError) {
          return json({ error: `Não foi possível remover a autorização de ${user.username}. Foram excluídos ${deleted} usuários; tente novamente.`, deleted }, 500);
        }

        const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
        if (deleteError) {
          await admin.from("account_allowlist")
            .update({ active: true })
            .eq("username", user.username)
            .eq("cnpj", manager.cnpj);
          return json({ error: `Não foi possível excluir ${user.username}. Foram excluídos ${deleted} usuários; tente novamente.`, deleted }, 500);
        }
        deleted++;
      }
      return json({ ok: true, deleted });
    }

    if (action === "list") {
      const { data, error } = await admin
        .from("profiles")
        .select("id,username,display_name,role,active,created_at,permissions")
        .eq("account_id", manager.account_id)
        .eq("role", "pdv")
        .order("created_at", { ascending: false });
      if (error) return json({ error: "Não foi possível carregar os usuários." }, 500);
      return json({ users: (data ?? []).map((user) => ({ ...user, permissions: Array.isArray(user.permissions) ? user.permissions : ["PDV", "Conferência"] })) });
    }

    if (action === "create") {
      const username = String(body.username ?? "").trim().toUpperCase();
      const displayName = String(body.displayName ?? "").trim() || username;
      let permissions = Array.isArray(body.permissions) ? body.permissions.filter((p: unknown) => ["PDV", "Conferência", "Validade", "Fiado", "Gerência"].includes(String(p))) : ["PDV", "Conferência"];

      // The first operator created for a company automatically receives Gerência
      // so the company is not locked out during initial setup.
      const { data: existingPdvUsers, error: existingPdvUsersError } = await admin
        .from("profiles")
        .select("id")
        .eq("account_id", manager.account_id)
        .eq("role", "pdv")
        .limit(1);
      if (existingPdvUsersError) return json({ error: "Não foi possível verificar se este é o primeiro usuário da empresa." }, 500);
      if (!existingPdvUsers?.length && !permissions.includes("Gerência")) permissions = [...permissions, "Gerência"];
      const password = String(body.password ?? "");
      if (!/^[A-Z0-9._-]{3,40}$/.test(username)) return json({ error: "Usuário inválido. Use letras, números, ponto, hífen ou underline." }, 400);
      if (password.length < 6) return json({ error: "A senha precisa ter pelo menos 6 caracteres." }, 400);

      const { data: existing } = await admin.from("profiles").select("id").eq("username", username).maybeSingle();
      if (existing) return json({ error: "Esse usuário já existe." }, 409);

      const email = username.toLowerCase().replace(/[^a-z0-9._-]/g, "-") + "@accounts.mobflow.local";

      const { data: existingAllowlist } = await admin
        .from("account_allowlist")
        .select("username,cnpj,active")
        .eq("username", username)
        .maybeSingle();

      if (existingAllowlist && existingAllowlist.cnpj !== manager.cnpj) {
        return json({ error: "Esse usuário já está vinculado a outra empresa." }, 409);
      }

      let createdAllowlist = false;
      if (!existingAllowlist) {
        const { error: allowlistError } = await admin
          .from("account_allowlist")
          .insert({ username, cnpj: manager.cnpj, active: true });
        if (allowlistError) return json({ error: "Não foi possível autorizar o usuário para esta empresa." }, 500);
        createdAllowlist = true;
      } else if (!existingAllowlist.active) {
        const { error: allowlistError } = await admin
          .from("account_allowlist")
          .update({ cnpj: manager.cnpj, active: true })
          .eq("username", username);
        if (allowlistError) return json({ error: "Não foi possível reativar a autorização do usuário." }, 500);
      }

      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });

      if (createError || !created.user) {
        if (createdAllowlist) await admin.from("account_allowlist").delete().eq("username", username);
        const msg = createError?.message ?? "";
        return json({
          error: msg.includes("Database error")
            ? "O banco recusou a criação do usuário."
            : msg.includes("already")
              ? "Esse usuário já existe."
              : (msg || "Não foi possível criar o usuário.")
        }, 400);
      }

      const { error: insertError } = await admin.from("profiles").upsert({
        id: created.user.id,
        username,
        cnpj: manager.cnpj,
        account_id: manager.account_id,
        role: "pdv",
        active: true,
        display_name: displayName,
        permissions
      }, { onConflict: "id" });

      if (insertError) {
        await admin.auth.admin.deleteUser(created.user.id);
        if (createdAllowlist) await admin.from("account_allowlist").delete().eq("username", username);
        return json({ error: "Não foi possível salvar o usuário." }, 500);
      }
      return json({ ok: true });
    }

    const userId = String(body.userId ?? "");
    if (!userId) return json({ error: "Usuário não informado." }, 400);

    const { data: target } = await admin
      .from("profiles")
      .select("id,username,cnpj,account_id,role")
      .eq("id", userId)
      .maybeSingle();

    if (!target || target.account_id !== manager.account_id || target.role !== "pdv") {
      return json({ error: "Usuário não encontrado." }, 404);
    }

    if (action === "update_permissions") {
      const permissions = Array.isArray(body.permissions) ? [...new Set(body.permissions.filter((p: unknown) => ["PDV", "Conferência", "Validade", "Fiado", "Gerência"].includes(String(p))))] : null;
      if (!permissions) return json({ error: "Informe as permissões de acesso do usuário." }, 400);
      if (target.id === manager.id && Array.isArray(manager.permissions) && manager.permissions.includes("Gerência") && !permissions.includes("Gerência")) {
        return json({ error: "Você não pode desativar a permissão Gerência do usuário que está usando agora, pois pode perder o acesso total à empresa. As outras permissões podem ser alteradas normalmente." }, 403);
      }
      if (permissions.includes("Gerência") && manager.role !== "manager") {
        return json({ error: "Somente a conta principal da empresa pode conceder a permissão Gerência. Este usuário tem acesso à Gerência, mas não é a conta principal." }, 403);
      }
      const { error } = await admin.from("profiles").update({ permissions }).eq("id", userId);
      if (error) return json({ error: "Não foi possível salvar as permissões." }, 500);
      return json({ ok: true });
    }

    if (action === "toggle") {
      const active = Boolean(body.active);
      const { error } = await admin.from("profiles").update({ active }).eq("id", userId);
      if (error) return json({ error: "Não foi possível alterar o acesso." }, 500);
      return json({ ok: true });
    }

    if (action === "reset_password") {
      const password = String(body.password ?? "");
      if (password.length < 6) return json({ error: "A senha precisa ter pelo menos 6 caracteres." }, 400);
      const { error } = await admin.auth.admin.updateUserById(userId, { password });
      if (error) return json({ error: "Não foi possível trocar a senha." }, 500);
      return json({ ok: true });
    }

    if (action === "delete") {
      const { error: allowlistError } = await admin
        .from("account_allowlist")
        .update({ active: false })
        .eq("username", target.username)
        .eq("cnpj", manager.cnpj);
      if (allowlistError) return json({ error: "Não foi possível remover a autorização do usuário. Nada foi excluído." }, 500);

      const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
      if (deleteError) {
        await admin.from("account_allowlist").update({ active: true }).eq("username", target.username).eq("cnpj", manager.cnpj);
        return json({ error: "Não foi possível excluir o usuário. A autorização foi restaurada." }, 500);
      }
      return json({ ok: true });
    }

    return json({ error: "Ação inválida." }, 400);
  } catch {
    return json({ error: "Não foi possível concluir a operação." }, 500);
  }
});