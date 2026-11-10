import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
const {client,beginAuthenticatedTransaction,releaseTransaction}=vi.hoisted(()=>{const query=vi.fn();const client={query,release:vi.fn()};return{client,beginAuthenticatedTransaction:vi.fn(),releaseTransaction:vi.fn(async()=>undefined)};});
vi.mock("@/lib/server/mobflow-auth",()=>({beginAuthenticatedTransaction,jsonError:(e:unknown)=>Response.json({error:String(e)},{status:500})}));
vi.mock("@/lib/server/neon",()=>({releaseTransaction}));
import {handleMobFlowStock} from "@/routes/api/mobflow/stock";
const USER="6c47eaac-2abf-4cd6-b614-24e27077bdf6",ACCOUNT="9c47eaac-2abf-4cd6-b614-24e27077bdf6",KEY="7c47eaac-2abf-4cd6-b614-24e27077bdf6";
const req=(body:Record<string,unknown>)=>new Request("https://mobflow.test/api/mobflow/stock",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
describe("Neon stock commands",()=>{
 const old=process.env.MOBFLOW_AUTH_PROVIDER;
 beforeEach(()=>{vi.clearAllMocks();process.env.MOBFLOW_AUTH_PROVIDER="better-auth";client.query.mockImplementation(async(sql:string)=>{
  if(sql.includes("to_regclass"))return{rows:[{products:"products",ledger:"stock_movements",events:"mobflow_sync_events",append_fn:"fn"}]};
  if(sql.includes("FROM public.stock_movements WHERE tenant_id=$1 AND operation_id"))return{rows:[]};
  if(sql.includes("FROM public.products"))return{rows:[{id:"p1",code:"SKU",name:"Produto",unit:"un",cost:"4",price:"10",stock:"10",active:true}]};
  if(sql.includes("UPDATE public.products"))return{rowCount:1,rows:[]};return{rows:[]};
 });beginAuthenticatedTransaction.mockResolvedValue({client,identity:{userId:USER,accountId:ACCOUNT,role:"manager",username:"gerente",displayName:"Gerente",permissions:[]}});});
 afterEach(()=>{if(old===undefined)delete process.env.MOBFLOW_AUTH_PROVIDER;else process.env.MOBFLOW_AUTH_PROVIDER=old;});
 it("applies an entry with stock and ledger in one commit",async()=>{
  const res=await handleMobFlowStock(req({operationId:"op-entry",idempotencyKey:KEY,operationType:"entry",reason:"Compra",items:[{productId:"p1",quantity:5}]}));
  const body=await res.json();expect(res.status).toBe(201);expect(body.operation.items[0]).toMatchObject({stockBefore:10,stockAfter:15,delta:5});
  expect(client.query.mock.calls.some(c=>String(c[0]).includes("UPDATE public.products"))).toBe(true);
  expect(client.query.mock.calls.some(c=>String(c[0]).includes("INSERT INTO public.stock_movements"))).toBe(true);
  expect(releaseTransaction).toHaveBeenCalledWith(client,true);
 });
 it("publishes a complete writeoff event with the selected cost basis",async()=>{
  const res=await handleMobFlowStock(req({operationId:"op-writeoff",idempotencyKey:KEY,operationType:"writeoff",reason:"Doação",donationDestination:"Instituição",number:"NF: 00010",costMode:"media",items:[{productId:"p1",quantity:2}]}));
  expect(res.status).toBe(201);
  const eventCall=client.query.mock.calls.find(c=>String(c[0]).includes("'stock_writeoff'"));
  expect(eventCall).toBeTruthy();
  const payload=JSON.parse(String(eventCall?.[1]?.[3]));
  expect(payload).toMatchObject({operation:"upsert",stockOperation:{id:"op-writeoff",reason:"Doação",costMode:"media",donationDestination:"Instituição",number:"NF: 00010"}});
  expect(payload.stockOperation.items[0]).toMatchObject({unitCost:7,totalCost:14,previousStock:10,newStock:8});
 });
 it("rejects a writeoff that would create negative stock",async()=>{
  const res=await handleMobFlowStock(req({operationId:"op-loss",idempotencyKey:KEY,operationType:"writeoff",reason:"Perda",costMode:"compra",items:[{productId:"p1",quantity:11}]}));
  expect(res.status).toBe(409);expect((await res.json()).code).toBe("insufficient_stock");
  expect(client.query.mock.calls.some(c=>String(c[0]).includes("UPDATE public.products"))).toBe(false);
  expect(releaseTransaction).toHaveBeenCalledWith(client,false);
 });

 it("records an external transfer and redacts private destination details from its event",async()=>{
  const res=await handleMobFlowStock(req({operationId:"op-transfer",idempotencyKey:KEY,operationType:"transfer",reason:"Transferência",destinationName:"Cliente de destino",destinationDocument:"12345678900",destinationPhone:"15999999999",destinationStreet:"Rua Teste",costMode:"media",items:[{productId:"p1",quantity:2}]}));
  expect(res.status).toBe(201);
  expect(client.query.mock.calls.some(c=>String(c[0]).includes("UPDATE public.products"))).toBe(true);
  expect(client.query.mock.calls.some(c=>String(c[0]).includes("INSERT INTO public.stock_movements"))).toBe(true);
  expect(client.query.mock.calls.some(c=>String(c[0]).includes("stockTransfers"))).toBe(true);
  const eventCall=client.query.mock.calls.find(c=>String(c[0]).includes("'stock_transfer'"));
  expect(eventCall).toBeTruthy();
  const payload=JSON.parse(String(eventCall?.[1]?.[3]));
  expect(payload.stockOperation.destinationName).toBe("Cliente de destino");
  expect(JSON.stringify(payload)).not.toContain("12345678900");
  expect(JSON.stringify(payload)).not.toContain("15999999999");
 });
 it("replays the same operation without applying stock twice",async()=>{
  client.query.mockImplementation(async(sql:string)=>{
   if(sql.includes("to_regclass"))return{rows:[{products:"products",ledger:"stock_movements",events:"mobflow_sync_events",append_fn:"fn"}]};
   if(sql.includes("FROM public.stock_movements WHERE tenant_id=$1 AND operation_id"))return{rows:[{operation_id:"op-entry",operation_type:"entry",product_id:"p1",quantity:"5",delta:"5",stock_before:"10",details:"Compra",idempotency_key:"bdb989b2-0f0a-5b37-8149-00911f6eb6f4"}]};
   return{rows:[]};
  });
  const res=await handleMobFlowStock(req({operationId:"op-entry",idempotencyKey:KEY,operationType:"entry",reason:"Compra",items:[{productId:"p1",quantity:5}]}));
  expect(res.status).toBe(200);expect((await res.json()).replayed).toBe(true);
  expect(client.query.mock.calls.some(c=>String(c[0]).includes("UPDATE public.products"))).toBe(false);
 });
});
