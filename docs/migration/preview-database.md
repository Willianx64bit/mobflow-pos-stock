# MobFlow Preview database

- Preview branch: `migration/neon-preparation`
- Neon branch: `realtime-validation`
- Preview database: `mobflow_auth_import_rehearsal`
- Runtime connection uses the Preview-only Neon owner connection and switches authenticated API transactions to `mobflow_api`.
- Neon Realtime is enabled for this branch. The browser receives only the public Realtime URL; the sealing secret stays server-side.
- This Preview database contains the imported PDV identities, profiles, companies, app state and manager security hashes, plus the Admin identity needed for integrated testing.

Production environment variables and the `main` branch were not changed.
