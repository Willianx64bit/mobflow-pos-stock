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
import { Route } from "@/routes/api/mobflow/products/inventory";
const handler=(Route as any).server.handlers.GET;
const TENANT="9c47eaac-2abf-4cd6-b614-24e27077bdf6";
const summary={total:"100000",active:"99000",inactive:"1000",low_stock:"120",inventory_value:"123456.78"};
const product={id:"p1",code:"001",name:"Arroz",reference:null,unit:"un",price:"10.00",stock:"5.000",min_stock:"1.000",category:"Mercearia",photo_object_key:null,active:true,version:"2",created_at:"2026-11-08 10:00:00.123456+00",barcodes:["7890001"]};
function req(url="https://mobflow.test/api/mobflow/products/inventory"){
 return new Request(url,{method:"GET"});
}
describe("Neon inventory API",()=>{
 const provider=process.env["MOBFLOW_AUTH_PROVIDER"];
 beforeEach(()=>{
  vi.clearAllMocks();process.env["MOBFLOW_AUTH_PROVIDER"]="better-auth";
  beginAuthenticatedTransaction.mockResolvedValue({client,identity:{userId:TENANT,accountId:TENANT,role:"manager",permissions:["Gerência"]}});
  client.query.mockReset();
 });
 afterEach(()=>{
  if(provider===undefined)delete process.env["MOBFLOW_AUTH_PROVIDER"];else process.env["MOBFLOW_AUTH_PROVIDER"]=provider;
 });
 it("filters inventory on Neon, caps pages at 100 and returns a global summary",async()=>{
  client.query.mockResolvedValueOnce({rows:[summary]}).mockResolvedValueOnce({rows:[product]});
  const response=await handler({request:req("https://mobflow.test/api/mobflow/products/inventory?limit=500&active=inactive&stock=low&q=arroz&category=mercearia")});
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    ok:true,products:[{id:"p1",name:"Arroz",barcodes:["7890001"]}],hasMore:false,nextCursor:null,
    summary:{total:100000,active:99000,inactive:1000,lowStock:120,inventoryValue:123456.78},
  });
  const [sql,params]=client.query.mock.calls[1] ?? [];
  expect(String(sql)).toContain("p.active=($2::text='active')");
  expect(String(sql)).toContain("p.stock<=p.min_stock");
  expect(String(sql)).toContain("p.category ILIKE '%'||$4||'%'");
  expect(String(sql)).toContain("ORDER BY p.created_at,p.id LIMIT $8");
  expect(params).toEqual([TENANT,"inactive","arroz","mercearia","low",null,null,101]);
  expect(releaseTransaction).toHaveBeenCalledWith(client,true);
 });
 it("returns an opaque cursor preserving PostgreSQL timestamp precision",async()=>{
  const createdAt="2026-11-08 10:00:00.123456+00";
  const expected="v2."+Buffer.from(JSON.stringify({createdAt,id:"p1"})).toString("base64url");
  client.query.mockResolvedValueOnce({rows:[summary]}).mockResolvedValueOnce({rows:[product,{...product,id:"p2",created_at:"2026-11-08 10:00:00.123457+00"}]});
  const response=await handler({request:req("https://mobflow.test/api/mobflow/products/inventory?limit=1")});
  expect(await response.json()).toMatchObject({hasMore:true,nextCursor:expected});
 });
 it("resolves legacy ID cursors from an older inventory page",async()=>{
  client.query.mockResolvedValueOnce({rows:[{created_at:"2026-11-07 00:00:00.123456+00",id:"legacy-p0"}]})
    .mockResolvedValueOnce({rows:[product]});
  const response=await handler({request:req("https://mobflow.test/api/mobflow/products/inventory?cursor=legacy-p0")});
  expect(response.status).toBe(200);
  expect(client.query.mock.calls[0]?.[0]).toContain("SELECT created_at::text AS created_at,id");
  expect(client.query.mock.calls[1]?.[1]).toEqual([TENANT,"all","","","all","2026-11-07 00:00:00.123456+00","legacy-p0",101]);
 });
 it("blocks inventory access for operators without Gerência",async()=>{
  beginAuthenticatedTransaction.mockResolvedValueOnce({client,identity:{userId:"u1",accountId:TENANT,role:"pdv",permissions:["PDV"]}});
  const response=await handler({request:req()});
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({code:"permission_denied"});
  expect(client.query).not.toHaveBeenCalled();
  expect(releaseTransaction).toHaveBeenCalledWith(client,false);
 });
});
