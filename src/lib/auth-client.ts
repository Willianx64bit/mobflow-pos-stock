import { createAuthClient } from "better-auth/react";

/**
 * The migration Preview uses Better Auth + Neon exclusively.
 */
export const mobflowAuthClient = createAuthClient();
export const isBetterAuthEnabled = true;
