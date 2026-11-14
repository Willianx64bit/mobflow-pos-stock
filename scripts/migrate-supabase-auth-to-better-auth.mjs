import { Pool } from "pg";

const apply = process.argv.includes("--apply");
const sourceUrl = process.env.SUPABASE_DATABASE_URL;
const targetUrl = process.env.MOBFLOW_AUTH_DATABASE_URL;

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

if (!sourceUrl || !targetUrl) {
  fail("Defina SUPABASE_DATABASE_URL e MOBFLOW_AUTH_DATABASE_URL no ambiente seguro.");
} else if (apply && process.env.CONFIRM_AUTH_IMPORT !== "YES") {
  fail("Para aplicar, use --apply e CONFIRM_AUTH_IMPORT=YES. Nenhuma alteração foi feita.");
} else {
  const source = new Pool({ connectionString: sourceUrl, max: 1, connectionTimeoutMillis: 10000 });
  const target = new Pool({ connectionString: targetUrl, max: 1, connectionTimeoutMillis: 10000 });

  try {
    const sourceClient = await source.connect();
    let targetClient;
    try {
      await sourceClient.query("BEGIN READ ONLY");
      const usersResult = await sourceClient.query(`
        SELECT
          id::text AS id,
          email,
          encrypted_password AS password_hash,
          email_confirmed_at,
          created_at,
          updated_at,
          raw_user_meta_data
        FROM auth.users
        WHERE deleted_at IS NULL
          AND email IS NOT NULL
        ORDER BY created_at, id
      `);
      const users = usersResult.rows;

      if (users.length === 0) throw new Error("Nenhuma conta ativa encontrada na origem.");
      const missingHashes = users.filter((user) => typeof user.password_hash !== "string" || !/^\$2[aby]\$\d{2}\$/.test(user.password_hash));
      if (missingHashes.length > 0) {
        throw new Error(`${missingHashes.length} conta(s) ativa(s) não possuem hash bcrypt compatível; importação interrompida.`);
      }

      const duplicateEmails = await sourceClient.query(`
        SELECT lower(email) AS normalized_email, count(*)::int AS total
        FROM auth.users
        WHERE deleted_at IS NULL AND email IS NOT NULL
        GROUP BY lower(email)
        HAVING count(*) > 1
      `);
      if (duplicateEmails.rowCount) throw new Error("Há e-mails duplicados na origem; importação interrompida.");

      const profileResult = await sourceClient.query(`
        SELECT count(*)::int AS total
        FROM public.profiles p
        JOIN auth.users u ON u.id = p.id
        WHERE u.deleted_at IS NULL AND u.email IS NOT NULL
      `);
      const profiles = profileResult.rows[0]?.total ?? 0;
      if (profiles !== users.length) {
        throw new Error("Nem todas as contas ativas possuem perfil MobFlow correspondente; importação interrompida.");
      }

      const providersResult = await sourceClient.query(`
        SELECT provider, count(*)::int AS total
        FROM auth.identities
        WHERE user_id = ANY($1::uuid[])
        GROUP BY provider
      `, [users.map((user) => user.id)]);
      const unsupportedProviders = providersResult.rows.filter((row) => row.provider !== "email");
      if (unsupportedProviders.length > 0) {
        throw new Error("Foram encontradas identidades OAuth ou provedores não previstos; importação interrompida.");
      }

      await sourceClient.query("COMMIT");

      targetClient = await target.connect();
      const targetCounts = await targetClient.query(`
        SELECT
          (SELECT count(*)::int FROM public."user") AS users,
          (SELECT count(*)::int FROM public."account") AS accounts,
          (SELECT count(*)::int FROM public."session") AS sessions
      `);
      const existing = targetCounts.rows[0];
      if (existing.users !== 0 || existing.accounts !== 0 || existing.sessions !== 0) {
        throw new Error("As tabelas Better Auth do destino não estão vazias; importação interrompida para evitar mistura de dados.");
      }

      console.log(JSON.stringify({
        mode: apply ? "apply" : "dry-run",
        activeUsers: users.length,
        bcryptHashes: missingHashes.length === 0 ? users.length : users.length - missingHashes.length,
        matchingProfiles: profiles,
        emailIdentities: providersResult.rows.find((row) => row.provider === "email")?.total ?? 0,
        existingTargetUsers: existing.users,
        existingTargetAccounts: existing.accounts,
        sessionsImported: 0,
        passwordHashesLogged: false,
      }, null, 2));

      if (apply) {
        await targetClient.query("BEGIN");
        try {
          for (const user of users) {
            const metadata = user.raw_user_meta_data && typeof user.raw_user_meta_data === "object"
              ? user.raw_user_meta_data
              : {};
            const name = metadata.full_name || metadata.name || metadata.username || user.email;

            await targetClient.query(`
              INSERT INTO public."user"
                (id, name, email, "emailVerified", "createdAt", "updatedAt")
              VALUES ($1, $2, $3, $4, $5, $6)
            `, [
              user.id,
              String(name),
              user.email,
              Boolean(user.email_confirmed_at),
              user.created_at,
              user.updated_at ?? user.created_at,
            ]);

            await targetClient.query(`
              INSERT INTO public."account"
                (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
              VALUES ($1, $1, 'credential', $1, $2, $3, $4)
            `, [
              user.id,
              user.password_hash,
              user.created_at,
              user.updated_at ?? user.created_at,
            ]);
          }

          const verification = await targetClient.query(`
            SELECT count(*)::int AS users,
                   (SELECT count(*)::int FROM public."account" WHERE "providerId" = 'credential') AS accounts
            FROM public."user"
          `);
          if (verification.rows[0].users !== users.length || verification.rows[0].accounts !== users.length) {
            throw new Error("A verificação pós-importação não corresponde à quantidade esperada.");
          }

          await targetClient.query("COMMIT");
          console.log("Importação concluída. Nenhuma sessão Supabase foi copiada; todos precisarão entrar novamente.");
        } catch (error) {
          await targetClient.query("ROLLBACK");
          throw error;
        }
      } else {
        console.log("Simulação concluída. Nenhuma conta ou hash foi gravado no destino.");
      }
    } catch (error) {
      await sourceClient.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      sourceClient.release();
      targetClient?.release();
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : "Falha na validação/importação.");
  } finally {
    await source.end();
    await target.end();
  }
}
