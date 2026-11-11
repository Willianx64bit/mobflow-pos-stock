import { createFileRoute } from "@tanstack/react-router";
import { randomUUID, createHash } from "node:crypto";
import { beginAuthenticatedTransaction, jsonError, ApiAuthError } from "@/lib/server/mobflow-auth";
import { releaseTransaction } from "@/lib/server/neon";

type PromotionRow = { id:string; product_id:string|null; product_name_snapshot:string; original_price:string; promo_price:string; starts_at:string|null; ends_at:string|null; version:string; updated_at:string };
class PromotionApiError extends Error { constructor(message:string,readonly status:number,readonly code:string){super(message);} }
const fail=(message:string,status=400,code="invalid_promotion"):never=>{throw new PromotionApiError(message,status,code);};
const canWrite=(i:{role:string;permissions:unknown})=>i.role==="manager"||(Array.isArray(i.permissions)&&i.permissions.includes("Gerência"));
const field=(v:unknown,name:string,required=false,max=160):string|null=>{if(v===undefined||v===null){if(required)fail("Campo "+name+" obrigatório.");return null;}if(typeof v!=="string")fail("Campo "+name+" inválido.");const s=v.trim();if(required&&!s)fail("Campo "+name+" obrigatório.");if(s.length>max)fail("Campo "+name+" excede o limite.");return s||null;};
const amount=(v:unknown,name:string):number=>{const n=typeof v==="number"?v:Number(v);if(!Number.isFinite(n)||n<0||Math.round(n*100)!==n*100)fail("Valor inválido: "+name+".");return n;};
const date=(v:unknown,name:string):string=>{if(typeof v!=="string"||!v||!Number.isFinite(Date.parse(v)))fail("Data inválida: "+name+".");return new Date(v).toISOString();};
const mapPromotion=(r:PromotionRow)=>({id:r.id,productId:r.product_id??"",productName:r.product_name_snapshot,originalPrice:Number(r.original_price),promoPrice:Number(r.promo_price),startsAt:r.starts_at??"",endsAt:r.ends_at??"",version:Number(r.version),updatedAt:r.updated_at});
const columns="id,product_id,product_name_snapshot,original_price::text,promo_price::text,starts_at,ends_at,version::text,updated_at";
function stableUuid(value:string){const b=createHash("sha256").update(value).digest().subarray(0,16);b[6]=(b[6]&15)|0x50;b[8]=(b[8]&0x3f)|0x80;const h=b.toString("hex");return h.slice(0,8)+"-"+h.slice(8,12)+"-"+h.slice(12,16)+"-"+h.slice(16,20)+"-"+h.slice(20);}
async function ready(c:any){const r=await c.query("SELECT to_regclass('public.promotions')::text AS p,to_regclass('public.mobflow_sync_events')::text AS e,to_regprocedure('public.mobflow_append_sync_event(uuid,uuid,text,text,text,text,jsonb)')::text AS fn");if(!r.rows[0]?.p||!r.rows[0]?.e||!r.rows[0]?.fn)throw new PromotionApiError("A estrutura de promoções e eventos ainda não está preparada no Neon.",503,"promotion_schema_not_ready");}
async function appendEvent(c:any,tenant:string,id:string,version:number,operation:"create"|"update"|"delete",promotion:unknown){const eventId=randomUUID();const result=await c.query("SELECT public.mobflow_append_sync_event($1::uuid,$2::uuid,'promotions','manual','promotion',$3,$4::jsonb) AS sequence",[eventId,stableUuid(tenant+":promotions:"+id+":"+version),id,JSON.stringify({operation,promotionId:id,version,promotion})]);return {eventId,sequence:String(result.rows[0].sequence)};}
function errorResponse(e:unknown){if(e instanceof PromotionApiError)return Response.json({ok:false,error:e.message,code:e.code},{status:e.status});if(e instanceof ApiAuthError)return jsonError(e);const code=typeof e==="object"&&e&&"code" in e?String((e as any).code):"";if(code==="23505")return Response.json({ok:false,error:"Já existe uma promoção com este identificador.",code:"promotion_conflict"},{status:409});if(code==="42P01"||code==="42501")return Response.json({ok:false,error:"A estrutura de promoções não está disponível neste ambiente.",code:"promotion_schema_not_ready"},{status:503});return jsonError(e);}
async function handle(request:Request,method:"GET"|"POST"|"PATCH"|"DELETE"){
 if(process.env["MOBFLOW_AUTH_PROVIDER"]!=="better-auth")return Response.json({ok:false,error:"Promoções Neon ainda não estão habilitadas neste ambiente.",code:"promotion_provider_disabled"},{status:503});
 let tx:any=null;
 try{
  tx=await beginAuthenticatedTransaction(request);const c=tx.client,i=tx.identity;await ready(c);
  if(method==="GET"){
   const promos=await c.query("SELECT "+columns+" FROM public.promotions WHERE tenant_id=$1 ORDER BY updated_at DESC,id",[i.accountId]);
   const events=await c.query("SELECT event_id,sequence::text,entity_id,payload,created_at FROM public.mobflow_sync_events WHERE tenant_id=$1 AND category='promotions' AND entity_type='promotion' ORDER BY sequence DESC LIMIT 100",[i.accountId]);
   await releaseTransaction(c,true);tx=null;return Response.json({ok:true,promotions:promos.rows.map(mapPromotion),events:events.rows});
  }
  if(!canWrite(i))fail("Somente a Gerência pode criar, editar ou excluir promoções.",403,"permission_denied");
  const body=await request.json().catch(()=>null);if(!body||typeof body!=="object"||Array.isArray(body))fail("Corpo da solicitação inválido.");
  if(method==="POST"){
   const id=field(body.id,"id",false,80)??randomUUID(),productId=field(body.productId,"produto",true,160)!,promoPrice=amount(body.promoPrice,"preço promocional"),startsAt=date(body.startsAt,"início"),endsAt=date(body.endsAt,"fim");
   if(Date.parse(endsAt)<=Date.parse(startsAt))fail("A data e hora final devem ser posteriores ao início.");
   const product=await c.query("SELECT name,price::text FROM public.products WHERE tenant_id=$1 AND id=$2 AND active=true LIMIT 1",[i.accountId,productId]);if(!product.rows[0])fail("Produto não encontrado ou inativo.",404,"product_not_found");
   const inserted=await c.query("INSERT INTO public.promotions(tenant_id,id,product_id,product_name_snapshot,original_price,promo_price,starts_at,ends_at,version,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,now()) RETURNING "+columns,[i.accountId,id,productId,product.rows[0].name,Number(product.rows[0].price),promoPrice,startsAt,endsAt]);
   const event=await appendEvent(c,i.accountId,id,1,"create",mapPromotion(inserted.rows[0]));await releaseTransaction(c,true);tx=null;
   return Response.json({ok:true,promotion:{...mapPromotion(inserted.rows[0]),eventId:event.eventId},event},{status:201});
  }
  const id=field(body.id,"id",true,80)!,expectedVersion=Number(body.expectedVersion);if(!Number.isSafeInteger(expectedVersion)||expectedVersion<1)fail("Versão esperada inválida.");
  const oldResult=await c.query("SELECT "+columns+" FROM public.promotions WHERE tenant_id=$1 AND id=$2 FOR UPDATE",[i.accountId,id]);if(!oldResult.rows[0])fail("Promoção não encontrada.",404,"promotion_not_found");
  const old=oldResult.rows[0] as PromotionRow;if(Number(old.version)!==expectedVersion)fail("Esta promoção foi alterada em outro dispositivo. Atualize a tela e tente novamente.",409,"version_conflict");
  if(method==="PATCH"){
   const productId=field(body.productId,"produto",true,160)!,promoPrice=amount(body.promoPrice,"preço promocional"),startsAt=date(body.startsAt,"início"),endsAt=date(body.endsAt,"fim");if(Date.parse(endsAt)<=Date.parse(startsAt))fail("A data e hora final devem ser posteriores ao início.");
   const product=await c.query("SELECT name,price::text FROM public.products WHERE tenant_id=$1 AND id=$2 AND active=true LIMIT 1",[i.accountId,productId]);if(!product.rows[0])fail("Produto não encontrado ou inativo.",404,"product_not_found");
   const updated=await c.query("UPDATE public.promotions SET product_id=$3,product_name_snapshot=$4,original_price=$5,promo_price=$6,starts_at=$7,ends_at=$8,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND version=$9 RETURNING "+columns,[i.accountId,id,productId,product.rows[0].name,Number(product.rows[0].price),promoPrice,startsAt,endsAt,expectedVersion]);
   if(!updated.rows[0])fail("Conflito de versão. Atualize e tente novamente.",409,"version_conflict");
   const promotion=mapPromotion(updated.rows[0]),event=await appendEvent(c,i.accountId,id,promotion.version,"update",promotion);await releaseTransaction(c,true);tx=null;
   return Response.json({ok:true,promotion:{...promotion,eventId:event.eventId},event});
  }
  const snapshot=mapPromotion(old),nextVersion=expectedVersion+1;
  await c.query("DELETE FROM public.promotions WHERE tenant_id=$1 AND id=$2 AND version=$3",[i.accountId,id,expectedVersion]);
  const event=await appendEvent(c,i.accountId,id,nextVersion,"delete",{...snapshot,version:nextVersion,deleted:true});await releaseTransaction(c,true);tx=null;
  return Response.json({ok:true,deleted:true,event});
 }catch(e){if(tx)await releaseTransaction(tx.client,false).catch(()=>{});return errorResponse(e);}
}
export const Route=createFileRoute("/api/mobflow/promotions")({server:{handlers:{GET:({request})=>handle(request,"GET"),POST:({request})=>handle(request,"POST"),PATCH:({request})=>handle(request,"PATCH"),DELETE:({request})=>handle(request,"DELETE")}}});
