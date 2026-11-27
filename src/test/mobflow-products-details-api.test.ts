import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { client, beginAuthenticatedTransaction, releaseTransaction } = vi.hoisted(() => ({
  client: { query: vi.fn() },
  beginAuthenticatedTransaction: vi.fn(),
  releaseTransaction: vi.fn(async (_client: unknown, _commit: boolean) => undefined),
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: (path: string) => (config: unknown) => ({ path, ...(config as object) }),
}));
vi.mock("@/lib/server/mobflow-auth", () => ({
  beginAuthenticatedTransaction,
  ApiAuthError: class ApiAuthError extends Error {},
  jsonError: () => Response.json({ ok:false, code:"internal_error" }, { status:500 }),
}));
vi.mock("@/lib/server/neon", () => ({ releaseTransaction }));
import { Route } from "@/routes/api/mobflow/products/details";
const handler=(Route as any).server.handlers.GET;
const TENANT="9c47eaac-2abf-4cd6-b614-24e27077bdf6";
function req(url="https://mobflow.test/api/mobflow/products/details?productId=p1"){
 return new Request(url,{method:"GET"});
}
describe("Neon product details API",()=>{
 const provider=process.env["MOBFLOW_AUTH_PROVIDER"];
 beforeEach(()=>{
  vi.clearAllMocks();process.env["MOBFLOW_AUTH_PROVIDER"]="better-auth";
  beginAuthenticatedTransaction.mockResolvedValue({client,identity:{userId:TENANT,accountId:TENANT,role:"manager",permissions:["Gerência"]}});
  client.query.mockReset();
 });
 afterEach(()=>{
  if(provider===undefined)delete process.env["MOBFLOW_AUTH_PROVIDER"];else process.env["MOBFLOW_AUTH_PROVIDER"]=provider;
 });
 it("returns cost and completed-sale totals only when requested",async()=>{
  client.query.mockResolvedValueOnce({rows:[{cost:"4.00",units_sold:"12.5",sales_count:"7",revenue:"250.00",cost_total:"50.00",gross_profit:"200.00"}]});
  const response=await handler({request:req()});
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ok:true,details:{cost:4,unitsSold:12.5,salesCount:7,revenue:250,costTotal:50,grossProfit:200}});
  expect(String(client.query.mock.calls[0]?.[0])).toContain("s.status='completed'");
  expect(String(client.query.mock.calls[0]?.[0])).toContain("GROUP BY p.tenant_id,p.id");
  expect(client.query.mock.calls[0]?.[1]).toEqual([TENANT,"p1"]);
  expect(releaseTransaction).toHaveBeenCalledWith(client,true);
 });
 it("does not disclose cost or sales totals to PDV operators",async()=>{
  beginAuthenticatedTransaction.mockResolvedValueOnce({client,identity:{userId:"u1",accountId:TENANT,role:"pdv",permissions:["PDV"]}});
  const response=await handler({request:req()});
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({code:"permission_denied"});
  expect(client.query).not.toHaveBeenCalled();
  expect(releaseTransaction).toHaveBeenCalledWith(client,false);
 });
 it("rejects an empty product ID",async()=>{
  const response=await handler({request:req("https://mobflow.test/api/mobflow/products/details")});
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({code:"invalid_product_id"});
  expect(beginAuthenticatedTransaction).not.toHaveBeenCalled();
 });
});
