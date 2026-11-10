import {createHash,randomUUID} from "node:crypto";
import {createFileRoute} from "@tanstack/react-router";
import {beginAuthenticatedTransaction,jsonError,ApiAuthError} from "@/lib/server/mobflow-auth";
import {releaseTransaction} from "@/lib/server/neon";
type Operation="adjustment"|"writeoff"|"entry"|"transfer";
type Input={operationId?:unknown;idempotencyKey?:unknown;operationType?:unknown;reason?:unknown;items?:unknown;costMode?:unknown;donationDestination?:unknown;number?:unknown;destinationName?:unknown;destinationDocument?:unknown;destinationPhone?:unknown;destinationStreet?:unknown;destinationNumber?:unknown;destinationCep?:unknown;destinationNeighborhood?:unknown;destinationCity?:unknown;destinationState?:unknown;};
class StockError extends Error{constructor(message:string,readonly status=400,readonly code="invalid_stock_operation"){super(message);}}
const fail=(m:string,s=400,c="invalid_stock_operation"):never=>{throw new StockError(m,s,c);};
const uuid=(v:unknown):v is string=>typeof v==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const str=(v:unknown,n=180)=>typeof v==="string"?v.trim().slice(0,n):"";
const qty3=(v:number)=>Math.round((v+Number.EPSILON)*1000)/1000;
const money=(v:number)=>Math.round((v+Number.EPSILON)*100)/100;
function stableUuid(v:string){const b=createHash("sha256").update(v).digest().subarray(0,16);b[6]=(b[6]&15)|0x50;b[8]=(b[8]&0x3f)|0x80;const h=b.toString("hex");return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;}
function errorResponse(e:unknown){if(e instanceof StockError)return Response.json({ok:false,error:e.message,code:e.code},{status:e.status});if(e instanceof ApiAuthError)return jsonError(e);const code=typeof e==="object"&&e&&"code"in e?String((e as {code:unknown}).code):"";if(code==="23505")return Response.json({ok:false,error:"Esta movimentação já foi registrada.",code:"duplicate_operation"},{status:409});if(code==="23503"||code==="23514")return Response.json({ok:false,error:"A movimentação não atende às regras do estoque.",code:"stock_constraint"},{status:409});return jsonError(e);}
async function schema(client:any){const r=await client.query("SELECT to_regclass('public.products')::text AS products,to_regclass('public.stock_movements')::text AS ledger,to_regclass('public.mobflow_sync_events')::text AS events,to_regprocedure('public.mobflow_append_sync_event(uuid,uuid,text,text,text,text,jsonb)')::text AS append_fn");if(Object.values(r.rows[0]??{}).some(v=>!v))fail("Estrutura relacional do estoque ainda não está pronta.",503,"stock_schema_not_ready");}
export async function handleMobFlowStock(request:Request){
 if(process.env.MOBFLOW_AUTH_PROVIDER!=="better-auth")return Response.json({ok:false,error:"Comandos Neon de estoque não habilitados neste ambiente.",code:"stock_provider_disabled"},{status:503});
 let tx:Awaited<ReturnType<typeof beginAuthenticatedTransaction>>|null=null;
 try{
  const body=await request.json().catch(()=>null) as Input|null;if(!body||typeof body!=="object")fail("Solicitação inválida.");
  const operationId=str(body.operationId,100),operationType=body.operationType as Operation,reason=str(body.reason,500);
  if(!operationId||!uuid(body.idempotencyKey)||!["adjustment","writeoff","entry","transfer"].includes(String(operationType))||!reason)fail("Identificação, tipo ou motivo inválido.");
  if(!Array.isArray(body.items)||body.items.length<1||body.items.length>300)fail("Itens inválidos.");
  const destinationName=str(body.destinationName,160);\n  if(operationType==="transfer"&&!destinationName)fail("Informe o destino da transferência.");
  const costMode=body.costMode==="venda"||body.costMode==="media"?body.costMode:"compra";
  const donationDestination=str(body.donationDestination,240);
  const writeoffNumber=str(body.number,40);
  if((operationType==="writeoff"||operationType==="transfer")&& !["compra","venda","media"].includes(String(body.costMode)))fail("Base de custo inválida para a operação.");
  if(operationType==="writeoff"&&reason==="Doação"&&!donationDestination)fail("Informe o destino da doação.");
  tx=await beginAuthenticatedTransaction(request);const {client,identity}=tx;
  if(!(identity.role==="manager"||(identity.role==="pdv"&&Array.isArray(identity.permissions)&&identity.permissions.includes("Operações"))))fail("Usuário sem permissão para movimentar estoque.",403,"permission_denied");
  await schema(client);
  const aggregated=new Map<string,{quantity:number;mode:"add"|"set"}>();
  for(const raw of body.items as Array<Record<string,unknown>>){
   const productId=str(raw?.productId,100),quantity=Number(raw?.quantity),mode=raw?.mode==="set"?"set":"add";
   if(!productId||!Number.isFinite(quantity)||quantity<0||Math.round(quantity*1000)!==quantity*1000||(quantity===0&&!(operationType==="adjustment"&&mode==="set")))fail("Produto ou quantidade inválida.");
   if(operationType!=="adjustment"&&mode!=="add")fail("Modo de quantidade inválido para esta operação.");
   const old=aggregated.get(productId);if(old&&old.mode!==mode)fail("Não misture modos de ajuste para o mesmo produto.");if(old&&mode==="set")fail("Informe cada produto uma única vez em ajuste por saldo final.");
   aggregated.set(productId,{quantity:qty3((old?.quantity??0)+quantity),mode});
  }
  const ids=[...aggregated.keys()].sort();
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[identity.accountId+":stock-operation:"+operationId]);
  const prior=await client.query("SELECT operation_id,operation_type,product_id,quantity::text,delta::text,stock_before::text,details,idempotency_key FROM public.stock_movements WHERE tenant_id=$1 AND operation_id=$2 ORDER BY product_id FOR UPDATE",[identity.accountId,operationId]);
  if(prior.rows.length){
   const same=prior.rows.length===ids.length&&prior.rows.every((r:any)=>{const wanted=aggregated.get(r.product_id);return r.operation_type===operationType&&!!wanted&&Math.abs(Number(r.quantity)-wanted.quantity)<0.0005&&r.details===reason&&Math.abs(Number(r.delta)-(operationType==="adjustment"&&wanted.mode==="set"?wanted.quantity-Number(r.stock_before):operationType==="entry"||operationType==="adjustment"?wanted.quantity:-wanted.quantity))<0.0005&&r.idempotency_key===stableUuid(identity.accountId+":stock:"+body.idempotencyKey+":"+r.product_id);});
   if(!same)fail("Identificador da operação reutilizado com conteúdo diferente.",409,"idempotency_conflict");
   await releaseTransaction(client,true);tx=null;
   return Response.json({ok:true,replayed:true,operation:{id:operationId,type:operationType,items:prior.rows.map((r:any)=>({productId:r.product_id,quantity:Number(r.quantity),delta:Number(r.delta)}))}});
  }
  const result=await client.query("SELECT id,code,name,unit,cost::text,price::text,stock::text,active FROM public.products WHERE tenant_id=$1 AND id=ANY($2::text[]) ORDER BY id FOR UPDATE",[identity.accountId,ids]);
  if(result.rows.length!==ids.length)fail("Produto não encontrado nesta empresa.",404,"product_not_found");
  const products=new Map<string,any>(result.rows.map((p:any)=>[p.id,p]));
  const changes=ids.map((id,index)=>{
   const p=products.get(id),item=aggregated.get(id)!;if(!p.active)fail("Produto inativo: "+p.name,409,"product_inactive");
   const before=Number(p.stock);let after:number,delta:number;
   if(operationType==="adjustment"&&item.mode==="set"){after=item.quantity;delta=qty3(after-before);}
   else {delta=operationType==="entry"||operationType==="adjustment"?item.quantity:-item.quantity;after=qty3(before+delta);}
   if(after<0)fail("Estoque insuficiente para "+p.name+".",409,"insufficient_stock");
   if(p.unit==="un"&&(!Number.isInteger(item.quantity)||!Number.isInteger(after)))fail("Produto por unidade não aceita quantidade fracionada.");
   const purchase=Math.max(0,Number(p.cost)),sale=Math.max(0,Number(p.price));
   const unitValue=costMode==="compra"?purchase:costMode==="venda"?sale:(purchase+sale)/2;
   return {p,item,before,after,delta,lineKey:String(index+1),value:money(Math.abs(delta)*unitValue),unitValue};
  });
  const now=new Date().toISOString();
  for(const x of changes){
   const update=await client.query("UPDATE public.products SET stock=$3,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND stock=$4",[identity.accountId,x.p.id,x.after,x.before]);
   if(update.rowCount!==1)fail("Estoque alterado por outra operação. Atualize e tente novamente.",409,"stock_conflict");
   const movementId=operationId+":"+x.p.id,key=stableUuid(identity.accountId+":stock:"+body.idempotencyKey+":"+x.p.id);
   await client.query("INSERT INTO public.stock_movements(tenant_id,id,operation_id,operation_type,line_key,product_id,product_code,product_name,unit,quantity,total_value,stock_before,stock_after,delta,operator_profile_id,operator_snapshot,details,occurred_at,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)",[identity.accountId,movementId,operationId,operationType,x.lineKey,x.p.id,x.p.code,x.p.name,x.p.unit,x.item.quantity,x.value,x.before,x.after,x.delta,identity.userId,identity.displayName||identity.username,reason,now,key]);
   await client.query("SELECT public.mobflow_append_sync_event($1::uuid,$2::uuid,'stock','automatic','product',$3,$4::jsonb)",[randomUUID(),stableUuid(identity.accountId+":stock-event:"+body.idempotencyKey+":"+x.p.id),x.p.id,JSON.stringify({operationId,operationType,delta:x.delta,stockBefore:x.before,stockAfter:x.after,quantity:x.item.quantity,productCode:str(x.p.code,80),productName:str(x.p.name,160),unit:x.p.unit,totalValue:x.value,reason,operator:identity.displayName||identity.username,occurredAt:now})]);
  }
  await client.query("SELECT public.mobflow_append_sync_event($1::uuid,$2::uuid,'stock','manual','stock_operation',$3,$4::jsonb)",[randomUUID(),stableUuid(identity.accountId+":stock-operation-event:"+body.idempotencyKey),operationId,JSON.stringify({operationId,operationType,reason,operator:identity.displayName||identity.username,occurredAt:now,items:operationType==="adjustment"?undefined:changes.map(x=>({productId:x.p.id,code:str(x.p.code,80),name:str(x.p.name,160),unit:x.p.unit,quantity:x.item.quantity,mode:x.item.mode==="set"?"definir":"somar",previousStock:x.before,newStock:x.after,delta:x.delta,totalValue:x.value})),stockAdjustment:operationType==="adjustment"?{id:operationId,date:now,reason,operator:identity.displayName||identity.username,items:changes.map(x=>({productId:x.p.id,code:str(x.p.code,80),name:str(x.p.name,160),unit:x.p.unit,mode:x.item.mode==="set"?"definir":"somar",quantity:x.item.quantity,previousStock:x.before,newStock:x.after}))}:undefined})]);
  if(operationType==="transfer") {
   const transfer={id:operationId,number:writeoffNumber||("TR: "+operationId.slice(-6)),date:now,reason:"Transferência de produtos, Vendas",destinationName,destinationDocument:str(body.destinationDocument,32)||undefined,destinationPhone:str(body.destinationPhone,32)||undefined,destinationStreet:str(body.destinationStreet,160)||undefined,destinationNumber:str(body.destinationNumber,30)||undefined,destinationCep:str(body.destinationCep,16)||undefined,destinationNeighborhood:str(body.destinationNeighborhood,100)||undefined,destinationCity:str(body.destinationCity,100)||undefined,destinationState:str(body.destinationState,2)||undefined,costMode,operator:identity.displayName||identity.username,items:changes.map(x=>({productId:x.p.id,code:str(x.p.code,80),ref:undefined,name:str(x.p.name,160),unit:x.p.unit,quantity:x.item.quantity,previousStock:x.before,newStock:x.after,costMode,unitCost:x.unitValue,totalCost:x.value}))};
   await client.query("UPDATE public.app_state SET state=jsonb_set(COALESCE(state,'{}'::jsonb),'{stockTransfers}',COALESCE(state->'stockTransfers','[]'::jsonb)||$2::jsonb,true),updated_at=now() WHERE owner_id=$1",[identity.accountId,JSON.stringify([transfer])]);
   const publicProjection={id:operationId,number:transfer.number,date:now,reason:transfer.reason,destinationName,costMode,operator:transfer.operator,items:transfer.items.map(x=>({productId:x.productId,code:x.code,name:x.name,unit:x.unit,quantity:x.quantity,previousStock:x.previousStock,newStock:x.newStock,costMode:x.costMode,unitCost:x.unitCost,totalCost:x.totalCost}))};
   await client.query("SELECT public.mobflow_append_sync_event($1::uuid,$2::uuid,'stock','manual','stock_transfer',$3,$4::jsonb)",[randomUUID(),stableUuid(identity.accountId+":stock-transfer-event:"+body.idempotencyKey),operationId,JSON.stringify({operation:"upsert",stockOperation:publicProjection,privateDetailsAvailable:true})]);
  }
  if(operationType==="writeoff") {
   const projection={id:operationId,number:writeoffNumber||("NF: "+operationId.slice(-5)),date:now,reason,costMode,donationDestination:reason==="Doação"?donationDestination:undefined,operator:identity.displayName||identity.username,items:changes.map(x=>({productId:x.p.id,code:str(x.p.code,80),name:str(x.p.name,160),unit:x.p.unit,quantity:x.item.quantity,previousStock:x.before,newStock:x.after,costMode,unitCost:x.unitValue,totalCost:x.value}))};
   await client.query("SELECT public.mobflow_append_sync_event($1::uuid,$2::uuid,'stock','manual','stock_writeoff',$3,$4::jsonb)",[randomUUID(),stableUuid(identity.accountId+":stock-writeoff-event:"+body.idempotencyKey),operationId,JSON.stringify({operation:"upsert",stockOperation:projection})]);
  }
  await releaseTransaction(client,true);tx=null;
  return Response.json({ok:true,replayed:false,operation:{id:operationId,type:operationType,items:changes.map(x=>({productId:x.p.id,quantity:x.item.quantity,stockBefore:x.before,stockAfter:x.after,delta:x.delta}))}},{status:201});
 }catch(e){if(tx)await releaseTransaction(tx.client,false).catch(()=>undefined);return errorResponse(e);}
}
export const Route=createFileRoute("/api/mobflow/stock")({server:{handlers:{POST:({request})=>handleMobFlowStock(request)}}});
