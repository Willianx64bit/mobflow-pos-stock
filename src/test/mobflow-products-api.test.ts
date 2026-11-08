import { beforeEach, describe, expect, it, vi } from "vitest";
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
import { Route } from "@/routes/api/mobflow/products";
const handlers=(Route as any).server.handlers;
const TENANT="9c47eaac-2abf-4cd6-b614-24e27077bdf6";
const ready={rows:[{p:"products",b:"product_barcodes"}]};
const product={id:"p1",code:"001",name:"Arroz",reference:null,unit:"un",price:"10.00",cost:"7.00",stock:"5.000",min_stock:"1.000",category:"Mercearia",photo_object_key:null,active:true,version:"1",created_at:"2026-11-08T10:00:00Z",updated_at:"2026-11-08T10:00:00Z"};
function req(method:string,body?:unknown,url="https://mobflow.test/api/mobflow/products"){
 return new Request(url,{method,headers:{"content-type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});
}
describe("Neon product catalog API",()=>{
 const provider=process.env.MOBFLOW_AUTH_PROVIDER;
 beforeEach(()=>{
  vi.clearAllMocks();process.env.MOBFLOW_AUTH_PROVIDER="better-auth";
  beginAuthenticatedTransaction.mockResolvedValue({client,identity:{userId:TENANT,accountId:TENANT,role:"manager",permissions:["Gerência"]}});
  client.query.mockReset();
  client.query.mockResolvedValue(ready);
 });
 afterEach(()=>{
  if(provider===undefined)delete process.env.MOBFLOW_AUTH_PROVIDER;else process.env.MOBFLOW_AUTH_PROVIDER=provider;
 });
 it("lists products scoped to the authenticated tenant",async()=>{
  client.query.mockResolvedValueOnce(ready).mockResolvedValueOnce({rows:[product]});
  const response=await handlers.GET({request:req("GET")});
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ok:true,products:[{id:"p1",name:"Arroz",stock:5}]});
  expect(client.query.mock.calls[1][1][0]).toBe(TENANT);
 });
 it("refuses catalog writes from users without Gerência",async()=>{
  beginAuthenticatedTransaction.mockResolvedValueOnce({client,identity:{userId:"u1",accountId:TENANT,role:"pdv",permissions:["PDV","Operações"]}});
  const response=await handlers.POST({request:req("POST",{id:"p1",code:"001",name:"Arroz",unit:"un",price:10})});
  expect(response.status).toBe(403);
  expect(client.query).not.toHaveBeenCalled();
 });
 it("creates product and its barcode in the same transaction",async()=>{
  client.query.mockResolvedValueOnce(ready).mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[product]});
  const response=await handlers.POST({request:req("POST",{id:"p1",code:"001",name:"Arroz",unit:"un",price:10,stock:5,barcodes:["7890001"]})});
  expect(response.status).toBe(201);
  expect(client.query.mock.calls.some(c=>String(c[0]).includes("INSERT INTO public.products"))).toBe(true);
  expect(client.query.mock.calls.some(c=>String(c[0]).includes("INSERT INTO public.product_barcodes"))).toBe(true);
  expect(releaseTransaction).toHaveBeenCalledWith(client,true);
 });
 it("rejects invalid unit and negative price",async()=>{
  const badUnit=await handlers.POST({request:req("POST",{id:"p2",code:"002",name:"Feijão",unit:"cx",price:5})});
  expect(badUnit.status).toBe(400);
  const badPrice=await handlers.POST({request:req("POST",{id:"p3",code:"003",name:"Feijão",unit:"un",price:-1})});
  expect(badPrice.status).toBe(400);
 });
 it("rejects stock edits through the catalog endpoint",async()=>{
  client.query.mockResolvedValueOnce(ready).mockResolvedValueOnce({rows:[product]});
  const response=await handlers.PATCH({request:req("PATCH",{id:"p1",expectedVersion:1,stock:99})});
  expect(response.status).toBe(400);
  expect(client.query.mock.calls.some(c=>String(c[0]).startsWith("UPDATE public.products"))).toBe(false);
 });
 it("returns version conflict instead of overwriting a concurrent edit",async()=>{
  client.query.mockResolvedValueOnce(ready).mockResolvedValueOnce({rows:[{...product,version:"2"}]});
  const response=await handlers.PATCH({request:req("PATCH",{id:"p1",expectedVersion:1,price:12})});
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({code:"version_conflict"});
 });
});
