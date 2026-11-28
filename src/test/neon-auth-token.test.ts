import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { connect } = vi.hoisted(() => {
  const query = vi.fn();
  const release = vi.fn();
  const client = { query, release };
  return { client, connect: vi.fn(async () => client) };
});

vi.mock("@/lib/server/neon", () => ({
  getNeonPool: () => ({ connect }),
}));

import { beginAuthenticatedTransaction } from "@/lib/server/mobflow-auth";

function request(token: string) {
  return new Request("https://mobflow.test/api/mobflow/session-context", {
    headers: { authorization: `Bearer ${token}` },
  });
}

describe("MobFlow legacy Neon Managed Auth bridge", () => {
  const originalProvider = process.env["MOBFLOW_AUTH_PROVIDER"];

  beforeEach(() => {
    vi.clearAllMocks();
    process.env["MOBFLOW_AUTH_PROVIDER"] = "neon";
  });

  afterEach(() => {
    if (originalProvider === undefined) delete process.env["MOBFLOW_AUTH_PROVIDER"];
    else process.env["MOBFLOW_AUTH_PROVIDER"] = originalProvider;
  });

  it("fails closed for the retired Neon Managed Auth provider before token verification or database access", async () => {
    await expect(beginAuthenticatedTransaction(request("legacy-neon-token"))).rejects.toMatchObject({
      status: 503,
      code: "better_auth_required",
    });
    expect(connect).not.toHaveBeenCalled();
  });
});
