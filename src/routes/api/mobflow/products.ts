import { createFileRoute } from "@tanstack/react-router";
import { beginAuthenticatedTransaction, jsonError, ApiAuthError } from "@/lib/server/mobflow-auth";
import { releaseTransaction } from "@/lib/server/neon";

type ProductRow = {
  id:string; code:string; name:string; reference:string|null; unit:"un"|"kg";
  price:string; cost:string; stock:string; min_stock:string; category:string|null;
  photo_object_key:string|null; active:boolean; version:string; created_at:string;
  updated_at:string; barcodes?:string[];
};
class ProductApiError extends Error {
  constructor(message:string, readonly status:number, readonly code:string){super(message);}
}
const fail=(message:string,status=400,code="invalid_product"):never=>{throw new ProductApiError(message,status,code);};
const field=(v:unknown,name:string,required=false,max=160):string|null=>{
  if(v===undefined||v===null){if(required)fail("Campo "+name+" obrigatório.");return null;}
  if(typeof v!=="string")fail("Campo "+name+" inválido.");
  const s=v.trim(); if(required&&!s)fail("Campo "+name+" obrigatório.");
  if(s.length>max)fail("Campo "+name+" excede o limite.");
  return s||null;
};
const amount=(v:unknown,name:string,fallback?:number):number=>{
  if(v===undefined&&fallback!==undefined)return fallback;
  const n=typeof v==="number"?v:Number(v);
  if(!Number.isFinite(n)||n<0||Math.round(n*100)!==n*100)fail("Valor inválido: "+name+".");
  return n;
};
const qty=(v:unknown,name:string,unit:"un"|"kg",fallback?:number):number=>{
  if(v===undefined&&fallback!==undefined)return fallback;
  const n=typeof v==="number"?v:Number(v),d=unit==="un"?0:3;
  if(!Number.isFinite(n)||n<0||Math.round(n*10**d)!==n*10**d)fail("Quantidade inválida: "+name+".");
  return n;
};
const barcodes=(v:unknown):string[]=>{
  if(v===undefined)return [];
  if(!Array.isArray(v)||v.length>30)fail("Lista de códigos inválida.");
  const a=v.map(x=>{if(typeof x!=="string"||!x.trim()||x.trim().length>80)fail("Código de barras inválido.");return x.trim();});
  if(new Set(a).size!==a.length)fail("Há códigos repetidos no produto.");
  return a;
};
const canWrite=(i:{role:string;permissions:unknown})=>i.role==="manager"||(Array.isArray(i.permissions)&&i.permissions.includes("Gerência"));
const mapProduct=(r:ProductRow)=>({
  id:r.id,code:r.code,name:r.name,ref:r.reference??undefined,unit:r.unit,
  price:Number(r.price),cost:Number(r.cost),stock:Number(r.stock),minStock:Number(r.min_stock),
  category:r.category??"",photoObjectKey:r.photo_object_key??undefined,active:r.active,
  version:Number(r.version),createdAt:r.created_at,updatedAt:r.updated_at,barcodes:r.barcodes??[],
});
const columns="id,code,name,reference,unit,price::text,cost::text,stock::text,min_stock::text,category,photo_object_key,active,version::text,created_at,updated_at";
async function ready(client:any){
 const r=await client.query("SELECT to_regclass('public.products')::text AS p,to_regclass('public.product_barcodes')::text AS b");
 if(!r.rows[0]?.p||!r.rows[0]?.b)throw new ProductApiError("O catálogo relacional ainda não foi preparado neste ambiente.",503,"catalog_schema_not_ready");
}
function errorResponse(e:unknown){
 if(e instanceof ProductApiError)return Response.json({ok:false,error:e.message,code:e.code},{status:e.status});
 if(e instanceof ApiAuthError)return jsonError(e);
 const c=typeof e==="object"&&e&&"code" in e?String((e as any).code):"";
 if(c==="23505")return Response.json({ok:false,error:"Código de barras já utilizado nesta empresa.",code:"duplicate_barcode"},{status:409});
 if(c==="42P01"||c==="42501")return Response.json({ok:false,error:"Catálogo indisponível neste ambiente.",code:"catalog_schema_not_ready"},{status:503});
 return jsonError(e);
}
async function getProducts(request:Request){
 if(process.env.MOBFLOW_AUTH_PROVIDER!=="better-auth")return Response.json({ok:false,error:"O catálogo Neon ainda não está habilitado neste ambiente.",code:"catalog_provider_disabled"},{status:503});
 const u=new URL(request.url),raw=u.searchParams.get("limit")??"50";
 if(!/^\d+$/.test(raw)||Number(raw)<1)return Response.json({ok:false,error:"Limite inválido.",code:"invalid_product_query"},{status:400});
 const limit=Math.min(Number(raw),100),cursor=u.searchParams.get("cursor"),q=(u.searchParams.get("q")??"").trim().slice(0,100),active=u.searchParams.get("active");
 if(cursor&&cursor.length>160||active!==null&&active!=="true"&&active!=="false")return Response.json({ok:false,error:"Filtro inválido.",code:"invalid_product_query"},{status:400});
 let tx:any=null;
 try{
  tx=await beginAuthenticatedTransaction(request);const c=tx.client;await ready(c);
  const result=await c.query(
   "SELECT p.id,p.code,p.name,p.reference,p.unit,p.price::text,p.cost::text,p.stock::text,p.min_stock::text,p.category,p.photo_object_key,p.active,p.version::text,p.created_at,p.updated_at,COALESCE(array_agg(b.barcode) FILTER(WHERE b.barcode IS NOT NULL),ARRAY[]::text[]) AS barcodes "+
   "FROM public.products p LEFT JOIN public.product_barcodes b ON b.tenant_id=p.tenant_id AND b.product_id=p.id "+
   "WHERE p.tenant_id=$1 AND ($2::boolean IS NULL OR p.active=$2) "+
   "AND ($3::text='' OR p.code ILIKE '%'||$3||'%' OR p.name ILIKE '%'||$3||'%' OR p.reference ILIKE '%'||$3||'%' OR EXISTS(SELECT 1 FROM public.product_barcodes bx WHERE bx.tenant_id=p.tenant_id AND bx.product_id=p.id AND bx.barcode ILIKE '%'||$3||'%')) "+
   "AND ($4::text IS NULL OR (p.name,p.id)>(SELECT cp.name,cp.id FROM public.products cp WHERE cp.tenant_id=p.tenant_id AND cp.id=$4)) "+
   "GROUP BY p.tenant_id,p.id ORDER BY p.name,p.id LIMIT $5",
   [tx.identity.accountId,active===null?null:active==="true",q,cursor,limit+1]);
  const more=result.rows.length>limit,rows=result.rows.slice(0,limit);
  await releaseTransaction(c,true);tx=null;
  return Response.json({ok:true,products:rows.map(mapProduct),nextCursor:more?rows[rows.length-1].id:null,hasMore:more});
 }catch(e){if(tx)await releaseTransaction(tx.client,false).catch(()=>{});return errorResponse(e);}
}
async function writeProduct(request:Request,method:"POST"|"PATCH"){
 if(process.env.MOBFLOW_AUTH_PROVIDER!=="better-auth")return Response.json({ok:false,error:"O catálogo Neon ainda não está habilitado neste ambiente.",code:"catalog_provider_disabled"},{status:503});
 let tx:any=null;
 try{
  const body=await request.json().catch(()=>null);
  if(!body||typeof body!=="object"||Array.isArray(body))fail("Corpo inválido.");
  tx=await beginAuthenticatedTransaction(request);const c=tx.client,i=tx.identity;
  if(!canWrite(i))fail("Somente a Gerência pode cadastrar ou alterar produtos.",403,"permission_denied");
  await ready(c);
  if(method==="POST"){
   const id=field(body.id,"id",true,80)!,code=field(body.code,"código",true,80)!,name=field(body.name,"nome",true,160)!;
   const ref=field(body.ref,"referência",false,80),category=field(body.category,"categoria",false,100);
   const unit=body.unit;if(unit!=="un"&&unit!=="kg")fail("Unidade inválida.");
   const price=amount(body.price,"preço"),cost=amount(body.cost,"custo",0),stock=qty(body.stock,"estoque inicial",unit,0),min=qty(body.minStock,"estoque mínimo",unit,0),codes=barcodes(body.barcodes);
   if(stock!==0)fail("O saldo inicial será liberado por uma operação de estoque auditável. Cadastre o produto com estoque zero.",400,"initial_stock_command_required");
   if(body.photo!==undefined||body.photoObjectKey!==undefined)fail("Fotos devem usar o fluxo seguro do R2.",400,"photo_upload_required");
   const prior=await c.query("SELECT "+columns+" FROM public.products WHERE tenant_id=$1 AND id=$2 FOR UPDATE",[i.accountId,id]);
   if(prior.rows.length){
    const p=prior.rows[0],same=p.code===code&&p.name===name&&p.reference===ref&&p.unit===unit&&Number(p.price)===price&&Number(p.cost)===cost&&Number(p.stock)===stock&&Number(p.min_stock)===min&&p.category===category;
    if(!same)fail("ID do produto já utilizado com outros dados.",409,"idempotency_conflict");
    await releaseTransaction(c,true);tx=null;return Response.json({ok:true,product:mapProduct(p),replayed:true});
   }
   const inserted=await c.query("INSERT INTO public.products(tenant_id,id,code,name,reference,unit,price,cost,stock,min_stock,category) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING "+columns,[i.accountId,id,code,name,ref,unit,price,cost,stock,min,category]);
   for(let n=0;n<codes.length;n++)await c.query("INSERT INTO public.product_barcodes(tenant_id,id,product_id,barcode,is_primary) VALUES($1,$2,$3,$4,$5)",[i.accountId,id+":barcode:"+n,id,codes[n],n===0]);
   await releaseTransaction(c,true);tx=null;
   return Response.json({ok:true,product:mapProduct({...inserted.rows[0],barcodes:codes}),replayed:false},{status:201});
  }
  const id=field(body.id,"id",true,80)!,version=Number(body.expectedVersion);
  if(!Number.isSafeInteger(version)||version<1)fail("Versão esperada inválida.");
  const permitted=["code","name","ref","category","unit","price","cost","minStock","active","barcodes"];
  if(Object.keys(body).some(k=>!["id","expectedVersion",...permitted].includes(k)))fail("A edição contém campos não permitidos.");
  const oldResult=await c.query("SELECT "+columns+" FROM public.products WHERE tenant_id=$1 AND id=$2 FOR UPDATE",[i.accountId,id]);
  if(!oldResult.rows.length)fail("Produto não encontrado.",404,"product_not_found");
  const old=oldResult.rows[0];if(Number(old.version)!==version)fail("Produto alterado em outro dispositivo. Atualize e tente novamente.",409,"version_conflict");
  const unit=body.unit===undefined?old.unit:body.unit;if(unit!=="un"&&unit!=="kg")fail("Unidade inválida.");
  const values=[
   field(body.code,"código",true,80)??old.code,field(body.name,"nome",true,160)??old.name,
   body.ref===undefined?old.reference:field(body.ref,"referência",false,80),
   body.category===undefined?old.category:field(body.category,"categoria",false,100),
   unit,amount(body.price,"preço",Number(old.price)),amount(body.cost,"custo",Number(old.cost)),
   qty(body.minStock,"estoque mínimo",unit,Number(old.min_stock)),
   body.active===undefined?old.active:body.active
  ];
  if(typeof values[8]!=="boolean")fail("Situação inválida.");
  const upd=await c.query("UPDATE public.products SET code=$3,name=$4,reference=$5,category=$6,unit=$7,price=$8,cost=$9,min_stock=$10,active=$11,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND version=$12 RETURNING "+columns,[i.accountId,id,...values,version]);
  if(!upd.rows.length)fail("Produto alterado em outro dispositivo.",409,"version_conflict");
  if(body.barcodes!==undefined){
   const codes=barcodes(body.barcodes);await c.query("DELETE FROM public.product_barcodes WHERE tenant_id=$1 AND product_id=$2",[i.accountId,id]);
   for(let n=0;n<codes.length;n++)await c.query("INSERT INTO public.product_barcodes(tenant_id,id,product_id,barcode,is_primary) VALUES($1,$2,$3,$4,$5)",[i.accountId,id+":barcode:"+n,id,codes[n],n===0]);
  }
  const b=await c.query("SELECT barcode FROM public.product_barcodes WHERE tenant_id=$1 AND product_id=$2 ORDER BY is_primary DESC,created_at",[i.accountId,id]);
  await releaseTransaction(c,true);tx=null;return Response.json({ok:true,product:mapProduct({...upd.rows[0],barcodes:b.rows.map((x:any)=>x.barcode)})});
 }catch(e){if(tx)await releaseTransaction(tx.client,false).catch(()=>{});return errorResponse(e);}
}
export const Route=createFileRoute("/api/mobflow/products")({server:{handlers:{
 GET:({request})=>getProducts(request),POST:({request})=>writeProduct(request,"POST"),PATCH:({request})=>writeProduct(request,"PATCH")
}}});
