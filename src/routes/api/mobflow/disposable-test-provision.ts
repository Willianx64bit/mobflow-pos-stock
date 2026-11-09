import { createFileRoute } from "@tanstack/react-router";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { getNeonPool } from "@/lib/server/neon";

const EXPECTED_DATABASE = "mobflow_sync_test";
const EXPECTED_HOST_PREFIX = "ep-billowing-dream-bdato2eg";

function unavailable() {
  return Response.json({ ok: false, error: "Provisionamento indisponível." }, { status: 404 });
}

async function provision(request: Request) {
  const enabled = process.env.MOBFLOW_DISPOSABLE_TEST_PROVISIONING === "true";
  const expectedSecret = process.env.MOBFLOW_DISPOSABLE_TEST_PROVISIONING_SECRET ?? "";
  const branch = process.env.VERCEL_GIT_COMMIT_REF ?? "";
  const environment = process.env.VERCEL_ENV ?? "";
  const databaseUrl = process.env.NEON_DATABASE_URL ?? "";

  if (!enabled || environment !== "preview" || branch !== "migration/neon-preparation" ||
      !expectedSecret || !databaseUrl) return unavailable();

  let host = "";
  try { host = new URL(databaseUrl).hostname; } catch { return unavailable(); }
  if (!host.startsWith(EXPECTED_HOST_PREFIX) || !host.endsWith(".neon.tech")) return unavailable();

  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(supplied);
  const b = Buffer.from(expectedSecret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return unavailable();

  const client = await getNeonPool().connect();
  try {
    await client.query("BEGIN");
    const guard = await client.query<{ database_name: string; companies: string; profiles: string; users: string; auth_accounts: string; allowlist: string; app_states: string; products: string; sales: string; sync_events: string }>(
      `SELECT current_database() AS database_name,
        (SELECT count(*)::text FROM public.companies) AS companies,
        (SELECT count(*)::text FROM public.profiles) AS profiles,
        (SELECT count(*)::text FROM public."user") AS users,
        (SELECT count(*)::text FROM public."account") AS auth_accounts,
        (SELECT count(*)::text FROM public.account_allowlist) AS allowlist,
        (SELECT count(*)::text FROM public.app_state) AS app_states,
        (SELECT count(*)::text FROM public.products) AS products,
        (SELECT count(*)::text FROM public.sales) AS sales,
        (SELECT count(*)::text FROM public.mobflow_sync_events) AS sync_events`,
    );
    const state = guard.rows[0];
    if (!state || state.database_name !== EXPECTED_DATABASE ||
        [state.companies, state.profiles, state.users, state.auth_accounts, state.allowlist, state.app_states, state.products, state.sales, state.sync_events].some(v => v !== "0")) {
      await client.query("ROLLBACK");
      return unavailable();
    }

    const id = randomUUID();
    const username = "SYNC_TEST_" + randomBytes(3).toString("hex").toUpperCase();
    const password = "Tst-" + randomBytes(18).toString("base64url") + "9!";
    const cnpj = "00000000000000";
    const email = username.toLowerCase() + "@example.invalid";
    const now = new Date();
    const passwordHash = await bcrypt.hash(password, 12);

    await client.query(
      `INSERT INTO public."user" (id,name,email,"emailVerified","createdAt","updatedAt")
       VALUES ($1,$2,$3,true,$4,$4)`,
      [id, username, email, now],
    );
    await client.query(
      `INSERT INTO public."account" (id,"accountId","providerId","userId",password,"createdAt","updatedAt")
       VALUES ($1,$1,'credential',$1,$2,$3,$3)`,
      [id, passwordHash, now],
    );
    await client.query(
      `INSERT INTO public.profiles (id,username,cnpj,account_id,role,active,display_name,permissions)
       VALUES ($1,$2,$3,$1,'manager',true,'EMPRESA TESTE DESCARTÁVEL',$4::jsonb)`,
      [id, username, cnpj, JSON.stringify(["PDV","Conferência","Validade","Fiado","Gerência"])],
    );
    await client.query(
      "INSERT INTO public.account_allowlist (username,cnpj,active) VALUES ($1,$2,true)",
      [username, cnpj],
    );
    await client.query(
      `INSERT INTO public.companies
       (account_id,company_name,cnpj,username,email,phone,plan_code,monthly_price,
        subscription_status,payment_method,subscription_expires_at)
       VALUES ($1,'EMPRESA TESTE DESCARTÁVEL',$2,$3,$4,'11900000000','complete',0,
        'active','pix',now()+interval '7 days')`,
      [id, cnpj, username, email],
    );
    await client.query(
      `INSERT INTO public.app_state (owner_id,state,updated_at)
       VALUES ($1,$2::jsonb,now())`,
      [id, JSON.stringify({
        products: [], cart: [], sales: [], conferences: [], receiving: [],
        manualExpiries: [], promotions: [], suppliers: [],
        settings: { companyName: "EMPRESA TESTE DESCARTÁVEL" },
      })],
    );
    await client.query("COMMIT");
    return Response.json({
      ok: true,
      environment: "Preview descartável",
      username,
      password,
      cnpj,
      company: "EMPRESA TESTE DESCARTÁVEL",
      message: "Credenciais temporárias. Guarde-as; a senha não será exibida novamente.",
    }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("[Disposable sync test provisioning]", error instanceof Error ? error.message : "unknown error");
    return Response.json({ ok: false, error: "Não foi possível provisionar a conta temporária." }, { status: 500 });
  } finally {
    client.release();
  }
}

function setupPage() {
  const html = `<!doctype html>
<html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Provisionar conta temporária MobFlow</title>
<style>
body{font:16px system-ui,sans-serif;background:#f5f7fb;color:#172033;margin:0;padding:24px}
main{max-width:480px;margin:8vh auto;background:white;padding:24px;border-radius:16px;box-shadow:0 8px 32px #18243a18}
h1{font-size:22px;margin:0 0 8px}p{line-height:1.5;color:#536078}
input,button{box-sizing:border-box;width:100%;padding:14px;border-radius:10px;font:inherit;margin-top:12px}
input{border:1px solid #cbd5e1}button{border:0;background:#1769e0;color:white;font-weight:700}
pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#eef2f8;padding:12px;border-radius:10px}
small{color:#64748b}
</style>
<main><h1>Conta temporária de sincronização</h1>
<p>Esta página funciona somente no Preview ligado ao banco descartável. A conta será criada uma única vez, se o banco continuar vazio.</p>
<label for="key">Chave temporária de provisionamento</label>
<input id="key" type="password" autocomplete="off" placeholder="Cole a chave recebida">
<button id="go">Criar conta de teste</button>
<p><small>Não use dados reais. As credenciais serão exibidas uma única vez.</small></p>
<pre id="result" hidden></pre></main>
<script>
document.getElementById("go").addEventListener("click",async()=>{
 const key=document.getElementById("key").value.trim(),out=document.getElementById("result"),btn=document.getElementById("go");
 if(!key){alert("Informe a chave temporária.");return}
 btn.disabled=true;btn.textContent="Criando...";out.hidden=false;out.textContent="Aguarde...";
 try{
  const response=await fetch("/api/mobflow/disposable-test-provision",{method:"POST",headers:{"Authorization":"Bearer "+key}});
  const data=await response.json();out.textContent=JSON.stringify(data,null,2);
  if(response.ok){document.getElementById("key").value="";btn.textContent="Conta criada";}else{btn.disabled=false;btn.textContent="Tentar novamente";}
 }catch(e){out.textContent="Falha de comunicação. Tente novamente.";btn.disabled=false;btn.textContent="Tentar novamente";}
});
</script></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

export const Route = createFileRoute("/api/mobflow/disposable-test-provision")({
  server: { handlers: {
    GET: () => setupPage(),
    POST: ({ request }) => provision(request),
  } },
});
