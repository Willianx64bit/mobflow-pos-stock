import { createHash, randomUUID } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { beginAuthenticatedTransaction, jsonError, ApiAuthError } from "@/lib/server/mobflow-auth";
import { releaseTransaction } from "@/lib/server/neon";

type CashInput = {
  action?: unknown;
  sessionId?: unknown;
  idempotencyKey?: unknown;
  openingAmount?: unknown;
  amount?: unknown;
  movementType?: unknown;
  reason?: unknown;
  countedAmount?: unknown;
  note?: unknown;
};
class CashError extends Error {
  constructor(message: string, readonly status = 400, readonly code = "invalid_cash_operation") { super(message); }
}
const fail = (message: string, status = 400, code = "invalid_cash_operation"): never => { throw new CashError(message, status, code); };
const validUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const str = (v: unknown, max = 160) => typeof v === "string" ? v.trim().slice(0,max) : "";
const cents = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
function stableUuid(value: string) {
  const b=createHash("sha256").update(value).digest().subarray(0,16); b[6]=((b[6]??0)&15)|0x50; b[8]=((b[8]??0)&0x3f)|0x80;
  const h=b.toString("hex"); return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
function respondError(error: unknown) {
  if(error instanceof CashError) return Response.json({ok:false,error:error.message,code:error.code},{status:error.status});
  if(error instanceof ApiAuthError) return jsonError(error);
  const code=typeof error==="object"&&error&&"code" in error?String((error as {code:unknown}).code):"";
  if(code==="23505") return Response.json({ok:false,error:"Esta operação já foi registrada.",code:"duplicate_operation"},{status:409});
  if(code==="23503"||code==="23514") return Response.json({ok:false,error:"A operação não atende às regras do caixa.",code:"cash_constraint"},{status:409});
  return jsonError(error);
}
async function assertSchema(client: any) {
  const r=await client.query("SELECT to_regclass('public.cash_sessions')::text AS sessions,to_regclass('public.cash_movements')::text AS movements,to_regclass('public.sales')::text AS sales,to_regclass('public.mobflow_sync_events')::text AS events,to_regprocedure('public.mobflow_append_sync_event(uuid,uuid,text,text,text,text,jsonb)')::text AS append_fn");
  const schemaRow = r.rows[0];
  if (!schemaRow || Object.values(schemaRow).some((v) => !v)) fail("A estrutura relacional do caixa ainda não está pronta.",503,"cash_schema_not_ready");
}
export async function handleMobFlowCash(request: Request) {
  if(process.env["MOBFLOW_AUTH_PROVIDER"]!=="better-auth") return Response.json({ok:false,error:"Comandos Neon de caixa não habilitados neste ambiente.",code:"cash_provider_disabled"},{status:503});
  let tx: Awaited<ReturnType<typeof beginAuthenticatedTransaction>>|null=null;
  try {
    const body=await request.json().catch(()=>null) as CashInput|null;
    if (!body || typeof body !== "object") {
      return Response.json({ ok: false, error: "Solicitação de caixa inválida.", code: "invalid_cash_operation" }, { status: 400 });
    }
    const action=str(body.action,20);
    const sessionId=str(body.sessionId,100);
    if(!["open","movement","close"].includes(action)||!sessionId||!validUuid(body.idempotencyKey)) fail("Identificadores ou ação do caixa inválidos.");
    tx=await beginAuthenticatedTransaction(request);
    const {client,identity}=tx;
    if(!(identity.role==="manager"||(identity.role==="pdv"&&Array.isArray(identity.permissions)&&identity.permissions.includes("PDV")))) fail("Usuário sem permissão para operar o caixa.",403,"permission_denied");
    await assertSchema(client);
    const operatorName=identity.displayName||identity.username;
    const now=new Date().toISOString();

    if(action==="open") {
      const opening=Number(body.openingAmount);
      if(!Number.isFinite(opening)||opening<0) fail("Valor inicial inválido.");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[identity.accountId+":cash-open:"+identity.userId]);
      const prior=await client.query("SELECT id,status,operator_profile_id,opening_amount::text,opened_at FROM public.cash_sessions WHERE tenant_id=$1 AND id=$2 FOR UPDATE",[identity.accountId,sessionId]);
      if(prior.rows.length) {
        const p=prior.rows[0];
        if(p.operator_profile_id!==identity.userId) fail("Identificador de caixa já utilizado.",409,"idempotency_conflict");
        if(p.status!=="open"||Number(p.opening_amount)!==cents(opening)) fail("Identificador de caixa reutilizado com dados diferentes.",409,"idempotency_conflict");
        await releaseTransaction(client,true); tx=null;
        return Response.json({ok:true,replayed:true,session:{id:p.id,status:p.status,openingAmount:Number(p.opening_amount),openedAt:p.opened_at}});
      }
      const active=await client.query("SELECT id,status,opening_amount::text,opened_at,opening_note FROM public.cash_sessions WHERE tenant_id=$1 AND operator_profile_id=$2 AND status='open' ORDER BY opened_at DESC LIMIT 1 FOR UPDATE",[identity.accountId,identity.userId]);
      if(active.rows.length) {
        const current=active.rows[0];
        await releaseTransaction(client,true); tx=null;
        return Response.json({ok:true,replayed:true,alreadyOpen:true,session:{id:current.id,status:current.status,openingAmount:Number(current.opening_amount),openedAt:current.opened_at,note:current.opening_note??undefined,operatorUsername:identity.username}});
      }
      await client.query("INSERT INTO public.cash_sessions(tenant_id,id,operator_profile_id,operator_snapshot,status,opening_amount,opened_at,opening_note) VALUES($1,$2,$3,$4,'open',$5,$6,$7)",[identity.accountId,sessionId,identity.userId,operatorName,cents(opening),now,str(body.note,500)||null]);
      await client.query("SELECT public.mobflow_append_sync_event($1::uuid,$2::uuid,'cash','automatic','cash_session',$3,$4::jsonb)",[randomUUID(),stableUuid(identity.accountId+":cash-open:"+sessionId),sessionId,JSON.stringify({sessionId,status:"open",openingAmount:cents(opening),operator:operatorName,operatorUsername:identity.username,openedAt:now,note:str(body.note,500)||undefined})]);
      await releaseTransaction(client,true); tx=null;
      return Response.json({ok:true,replayed:false,session:{id:sessionId,status:"open",openingAmount:cents(opening),openedAt:now}},{status:201});
    }

    if(action==="movement") {
      const amount=Number(body.amount), type=str(body.movementType,20), reason=str(body.reason,500);
      if(!Number.isFinite(amount)||amount<=0||!["addition","withdrawal"].includes(type)||!reason) fail("Tipo, valor ou motivo da movimentação inválido.");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[identity.accountId+":cash-movement:"+body.idempotencyKey]);
      const prior=await client.query("SELECT id,cash_session_id,movement_type,amount::text,reason,occurred_at,operator_profile_id FROM public.cash_movements WHERE tenant_id=$1 AND idempotency_key=$2 FOR UPDATE",[identity.accountId,body.idempotencyKey]);
      if(prior.rows.length) {
        const p=prior.rows[0];
        if(p.operator_profile_id!==identity.userId||p.cash_session_id!==sessionId||p.movement_type!==type||Number(p.amount)!==cents(amount)||p.reason!==reason) fail("Chave de idempotência reutilizada com dados diferentes.",409,"idempotency_conflict");
        await releaseTransaction(client,true); tx=null;
        return Response.json({ok:true,replayed:true,movement:{id:p.id,sessionId:p.cash_session_id,type:p.movement_type,amount:Number(p.amount),reason:p.reason,date:p.occurred_at}});
      }
      const session=await client.query("SELECT id,status,operator_profile_id FROM public.cash_sessions WHERE tenant_id=$1 AND id=$2 FOR UPDATE",[identity.accountId,sessionId]);
      if(!session.rows[0]||session.rows[0].status!=="open"||session.rows[0].operator_profile_id!==identity.userId) fail("Caixa aberto do operador não encontrado.",409,"cash_session_not_open");
      const movementId=str(body.idempotencyKey,100);
      await client.query("INSERT INTO public.cash_movements(tenant_id,id,cash_session_id,movement_type,amount,reason,operator_profile_id,operator_snapshot,occurred_at,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",[identity.accountId,movementId,sessionId,type,cents(amount),reason,identity.userId,operatorName,now,body.idempotencyKey]);
      await client.query("SELECT public.mobflow_append_sync_event($1::uuid,$2::uuid,'cash','automatic','cash_movement',$3,$4::jsonb)",[randomUUID(),stableUuid(identity.accountId+":cash-movement:"+body.idempotencyKey),movementId,JSON.stringify({sessionId,type,amount:cents(amount),reason,operator:operatorName,movement:{id:movementId,sessionId,type:type==="addition"?"reforco":"sangria",amount:cents(amount),reason,operator:operatorName,date:now}})]);
      await releaseTransaction(client,true); tx=null;
      return Response.json({ok:true,replayed:false,movement:{id:movementId,sessionId,type,amount:cents(amount),reason,date:now}},{status:201});
    }

    const counted=Number(body.countedAmount);
    if(!Number.isFinite(counted)||counted<0) fail("Valor contado inválido.");
    const sessionResult=await client.query("SELECT id,status,operator_profile_id,opening_amount::text,closed_at,counted_amount::text,expected_amount::text,difference_amount::text,close_idempotency_key FROM public.cash_sessions WHERE tenant_id=$1 AND id=$2 FOR UPDATE",[identity.accountId,sessionId]);
    const session=sessionResult.rows[0];
    if(!session) fail("Caixa não encontrado.",404,"cash_session_not_found");
    if(session.status==="closed") {
      if(session.operator_profile_id!==identity.userId) fail("Somente o operador responsável pode consultar o fechamento deste caixa.",403,"cash_operator_mismatch");
      if(session.close_idempotency_key!==body.idempotencyKey||Number(session.counted_amount)!==cents(counted)) fail("Caixa já foi fechado com outra operação.",409,"cash_already_closed");
      await releaseTransaction(client,true); tx=null;
      return Response.json({ok:true,replayed:true,closing:{sessionId,status:"closed",countedAmount:Number(session.counted_amount),expectedAmount:Number(session.expected_amount),difference:Number(session.difference_amount),closedAt:session.closed_at}});
    }
    if(session.operator_profile_id!==identity.userId) fail("Somente o operador responsável pode fechar este caixa.",403,"cash_operator_mismatch");
    const sales=await client.query("SELECT COALESCE(SUM(sp.amount),0)::text AS total FROM public.sale_payments sp JOIN public.sales s ON s.tenant_id=sp.tenant_id AND s.id=sp.sale_id WHERE sp.tenant_id=$1 AND s.cash_session_id=$2 AND s.status='completed' AND sp.method='cash'",[identity.accountId,sessionId]);
    const movements=await client.query("SELECT COALESCE(SUM(amount) FILTER(WHERE movement_type='addition'),0)::text AS additions,COALESCE(SUM(amount) FILTER(WHERE movement_type='withdrawal'),0)::text AS withdrawals FROM public.cash_movements WHERE tenant_id=$1 AND cash_session_id=$2",[identity.accountId,sessionId]);
    const expected=cents(Number(session.opening_amount)+Number(sales.rows[0].total)+Number(movements.rows[0].additions)-Number(movements.rows[0].withdrawals));
    const difference=cents(counted-expected);
    const closed = await client.query("UPDATE public.cash_sessions SET status='closed',closed_at=$3,closed_by_snapshot=$4,counted_amount=$5,expected_amount=$6,difference_amount=$7,closing_note=$8,close_idempotency_key=$9,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND status='open'",[identity.accountId,sessionId,now,operatorName,cents(counted),expected,difference,str(body.note,500)||null,body.idempotencyKey]);
    if(closed.rowCount!==1) fail("O caixa mudou durante o fechamento. Tente novamente.",409,"cash_close_conflict");
    await client.query("SELECT public.mobflow_append_sync_event($1::uuid,$2::uuid,'cash','automatic','cash_session',$3,$4::jsonb)",[randomUUID(),stableUuid(identity.accountId+":cash-close:"+sessionId),sessionId,JSON.stringify({sessionId,status:"closed",countedAmount:cents(counted),expectedAmount:expected,difference,operator:operatorName,closedAt:now,note:str(body.note,500)||undefined})]);
    await releaseTransaction(client,true); tx=null;
    return Response.json({ok:true,replayed:false,closing:{sessionId,status:"closed",countedAmount:cents(counted),expectedAmount:expected,difference,closedAt:now}},{status:200});
  } catch(error) {
    if(tx) await releaseTransaction(tx.client,false).catch(()=>undefined);
    return respondError(error);
  }
}
export async function handleGetMobFlowCash(request: Request) {
  if(process.env["MOBFLOW_AUTH_PROVIDER"]!=="better-auth") return Response.json({ok:false,error:"Consulta Neon de caixa não habilitada neste ambiente.",code:"cash_provider_disabled"},{status:503});
  let tx: Awaited<ReturnType<typeof beginAuthenticatedTransaction>>|null=null;
  try {
    tx=await beginAuthenticatedTransaction(request);
    const {client,identity}=tx;
    const result=await client.query("SELECT id,status,opening_amount::text,opened_at,opening_note FROM public.cash_sessions WHERE tenant_id=$1 AND operator_profile_id=$2 AND status='open' ORDER BY opened_at DESC LIMIT 1",[identity.accountId,identity.userId]);
    await releaseTransaction(client,true); tx=null;
    const row=result.rows[0];
    return Response.json({ok:true,session:row?{id:row.id,status:row.status,openingAmount:Number(row.opening_amount),openedAt:row.opened_at,note:row.opening_note??undefined,operatorUsername:identity.username}:null});
  } catch(error) {
    if(tx) await releaseTransaction(tx.client,false).catch(()=>undefined);
    return jsonError(error);
  }
}
export const Route=createFileRoute("/api/mobflow/cash")({server:{handlers:{GET:({request})=>handleGetMobFlowCash(request),POST:({request})=>handleMobFlowCash(request)}}});
