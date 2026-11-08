import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
const {client,beginAuthenticatedTransaction,releaseTransaction}=vi.hoisted(()=>{
 const query=vi.fn(); const client={query,release:vi.fn()};
 return {client,beginAuthenticatedTransaction:vi.fn(),releaseTransaction:vi.fn(async()=>undefined)};
});
vi.mock("@/lib/server/mobflow-auth",()=>({beginAuthenticatedTransaction,jsonError:(e:unknown)=>Response.json({error:String(e)},{status:500})}));
vi.mock("@/lib/server/neon",()=>({releaseTransaction}));
import {handleMobFlowCash} from "@/routes/api/mobflow/cash";
const USER="6c47eaac-2abf-4cd6-b614-24e27077bdf6",ACCOUNT="9c47eaac-2abf-4cd6-b614-24e27077bdf6";
const KEY="7c47eaac-2abf-4cd6-b614-24e27077bdf6";
const SESSION="cash-session-1";
const req=(body:Record<string,unknown>)=>new Request("https://mobflow.test/api/mobflow/cash",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
describe("Neon cash commands",()=>{
 const old=process.env.MOBFLOW_AUTH_PROVIDER;
 beforeEach(()=>{
  vi.clearAllMocks(); process.env.MOBFLOW_AUTH_PROVIDER="better-auth";
  client.query.mockImplementation(async(sql:string)=>{
   if(sql.includes("to_regclass")) return {rows:[{sessions:"cash_sessions",movements:"cash_movements",sales:"sales",events:"mobflow_sync_events",append_fn:"mobflow_append_sync_event"}]};
   if(sql.includes("FROM public.cash_sessions WHERE tenant_id=$1 AND id=$2 FOR UPDATE")) return {rows:[]};
   if(sql.includes("FROM public.cash_sessions WHERE tenant_id=$1 AND operator_profile_id")) return {rows:[]};
   if(sql.includes("FROM public.cash_movements WHERE")) return {rows:[]};
   if(sql.includes("FROM public.sales")) return {rows:[{total:"50.00"}]};
   if(sql.includes("FROM public.cash_movements WHERE tenant_id=$1 AND cash_session_id")) return {rows:[{additions:"10",withdrawals:"5"}]};
   if(sql.includes("UPDATE public.cash_sessions")) return {rowCount:1,rows:[]};
   return {rows:[]};
  });
  beginAuthenticatedTransaction.mockResolvedValue({client,identity:{userId:USER,accountId:ACCOUNT,role:"pdv",username:"op",displayName:"Operador",permissions:["PDV"]}});
 });
 afterEach(()=>{if(old===undefined)delete process.env.MOBFLOW_AUTH_PROVIDER;else process.env.MOBFLOW_AUTH_PROVIDER=old;});
 it("opens a cash session in one transaction",async()=>{
  const res=await handleMobFlowCash(req({action:"open",sessionId:SESSION,idempotencyKey:KEY,openingAmount:100}));
  expect(res.status).toBe(201);
  expect(client.query.mock.calls.some(c=>String(c[0]).includes("INSERT INTO public.cash_sessions"))).toBe(true);
  expect(releaseTransaction).toHaveBeenCalledWith(client,true);
 });
 it("records an idempotent cash addition or withdrawal",async()=>{
  client.query.mockImplementation(async(sql:string)=>{
   if(sql.includes("to_regclass"))return{rows:[{sessions:"cash_sessions",movements:"cash_movements",sales:"sales",events:"mobflow_sync_events",append_fn:"fn"}]};
   if(sql.includes("FROM public.cash_movements WHERE tenant_id=$1 AND idempotency_key"))return{rows:[]};
   if(sql.includes("FROM public.cash_sessions"))return{rows:[{id:SESSION,status:"open",operator_profile_id:USER}]};
   return{rows:[]};
  });
  const res=await handleMobFlowCash(req({action:"movement",sessionId:SESSION,idempotencyKey:KEY,movementType:"addition",amount:20,reason:"Troco"}));
  expect(res.status).toBe(201);
  expect(client.query.mock.calls.some(c=>String(c[0]).includes("INSERT INTO public.cash_movements"))).toBe(true);
 });
 it("closes and reconciles cash using server-side sales and movements",async()=>{
  client.query.mockImplementation(async(sql:string)=>{
   if(sql.includes("to_regclass"))return{rows:[{sessions:"cash_sessions",movements:"cash_movements",sales:"sales",events:"mobflow_sync_events",append_fn:"fn"}]};
   if(sql.includes("FROM public.cash_sessions WHERE tenant_id=$1 AND id=$2 FOR UPDATE"))return{rows:[{id:SESSION,status:"open",operator_profile_id:USER,opening_amount:"100"}]};
   if(sql.includes("FROM public.sales"))return{rows:[{total:"50"}]};
   if(sql.includes("FROM public.cash_movements"))return{rows:[{additions:"10",withdrawals:"5"}]};
   return{rows:[]};
  });
  const res=await handleMobFlowCash(req({action:"close",sessionId:SESSION,idempotencyKey:KEY,countedAmount:155}));
  const body=await res.json();
  expect(res.status).toBe(200);
  expect(body.closing).toMatchObject({expectedAmount:155,difference:0,status:"closed"});
  expect(releaseTransaction).toHaveBeenCalledWith(client,true);
 });
 it("rejects an unauthenticated role without PDV permission",async()=>{
  beginAuthenticatedTransaction.mockResolvedValue({client,identity:{userId:USER,accountId:ACCOUNT,role:"pdv",username:"op",displayName:"Operador",permissions:[]}});
  const res=await handleMobFlowCash(req({action:"open",sessionId:SESSION,idempotencyKey:KEY,openingAmount:0}));
  expect(res.status).toBe(403);
  expect(releaseTransaction).toHaveBeenCalledWith(client,false);
 });
});
