import { createAuthClient } from "better-auth/react";

/**
 * Browser client for the self-managed Better Auth server.
 * It uses the current MobFlow origin, so Preview and Production stay isolated.
 * Existing Supabase login remains active until the migration cutover is approved.
 */
export const mobflowAuthClient = createAuthClient();
