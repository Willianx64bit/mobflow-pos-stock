import { Pool } from "pg";

const apply = process.argv.includes("--apply");
const sourceUrl = process.env.SUPABASE_DATABASE_URL;
const targetUrl = process.env.MOBFLOW_AUTH_DATABASE_URL;

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function assertTargetIsIsolated(url) {
  const parsed = new URL(url);
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (databaseName !== "mobflow_auth_import_rehearsal") {
    throw new Error("Destino recusado: esta rotina só pode gravar em mobflow_auth_import_rehearsal.");
  }
}

if (!sourceUrl || !targetUrl) {
  fail("Defina SUPABASE_DATABASE_URL e MOBFLOW_AUTH_DATABASE_URL nos secrets do GitHub Actions.");
} else if (!apply || process.env.CONFIRM_MANAGER_SECURITY_IMPORT !== "YES") {
  fail("Importação protegida. Execute com --apply e CONFIRM_MANAGER_SECURITY_IMPORT=YES.");
} else {
  const source = new Pool({ connectionString: sourceUrl, max: 1, connectionTimeoutMillis: 10000 });
  const target = new Pool({ connectionString: targetUrl, max: 1, connectionTimeoutMillis: 10000 });

  try {
    assertTargetIsIsolated(targetUrl);
    const sourceClient = await source.connect();
    const targetClient = await target.connect();
    try {
      await sourceClient.query("BEGIN READ ONLY");
      const globalResult = await sourceClient.query(
        "SELECT id,password_hash FROM public.manager_security ORDER BY id",
      );
      const accountResult = await sourceClient.query(
        "SELECT account_id::text AS account_id,password_hash,updated_at FROM public.manager_security_by_account ORDER BY account_id",
      );
      if (globalResult.rowCount !== 1 || accountResult.rowCount !== 2) {
        throw new Error("A origem não corresponde ao inventário esperado (1 hash global e 2 hashes por empresa).");
      }
      await sourceClient.query("COMMIT");

      const existing = await targetClient.query(`
        SELECT
          (SELECT count(*)::int FROM public.manager_security) AS global_count,
          (SELECT count(*)::int FROM public.manager_security_by_account) AS account_count
      `);
      if (existing.rows[0].global_count !== 0 || existing.rows[0].account_count !== 0) {
        throw new Error("O destino já contém hashes de gerência; importação interrompida para evitar sobrescrita.");
      }

      await targetClient.query("BEGIN");
      try {
        for (const row of globalResult.rows) {
          await targetClient.query(
            "INSERT INTO public.manager_security(id,password_hash) VALUES($1,$2)",
            [row.id, row.password_hash],
          );
        }
        for (const row of accountResult.rows) {
          await targetClient.query(
            "INSERT INTO public.manager_security_by_account(account_id,password_hash,updated_at) VALUES($1,$2,$3)",
            [row.account_id, row.password_hash, row.updated_at],
          );
        }
        const verified = await targetClient.query(`
          SELECT
            (SELECT count(*)::int FROM public.manager_security) AS global_count,
            (SELECT count(*)::int FROM public.manager_security_by_account) AS account_count
        `);
        if (verified.rows[0].global_count !== 1 || verified.rows[0].account_count !== 2) {
          throw new Error("A conferência pós-importação falhou.");
        }
        await targetClient.query("COMMIT");
        console.log(JSON.stringify({
          status: "completed",
          globalManagerHashes: 1,
          perCompanyManagerHashes: 2,
          hashesLogged: false,
          recoveryTokensImported: 0,
        }, null, 2));
      } catch (error) {
        await targetClient.query("ROLLBACK");
        throw error;
      }
    } finally {
      sourceClient.release();
      targetClient.release();
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : "Falha na importação protegida.");
  } finally {
    await source.end();
    await target.end();
  }
}
