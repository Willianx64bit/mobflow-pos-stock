import { createAuthClient } from "better-auth/react";

/**
 * The migration Preview is Better Auth + Neon only.
 * Do not select the legacy Supabase authentication path based on a missing env flag.
 */
export const mobflowAuthClient = createAuthClient();
export const isBetterAuthEnabled = true;
