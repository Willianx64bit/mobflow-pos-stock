import { createFileRoute } from "@tanstack/react-router";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import { beginAuthenticatedTransaction, ApiAuthError } from "@/lib/server/mobflow-auth";
import { releaseTransaction } from "@/lib/server/neon";

const MAX_BYTES=5*1024*1024;
const formats={
 "image/png":{ext:"png",valid:(b:Uint8Array)=>b.length>=8&&[137,80,78,71,13,10,26,10].every((v,i)=>b[i]===v)},
 "image/jpeg":{ext:"jpg",valid:(b:Uint8Array)=>b.length>=3&&b[0]===255&&b[1]===216&&b[2]===255},
 "image/webp":{ext:"webp",valid:(b:Uint8Array)=>b.length>=12&&String.fromCharCode(...b.slice(0,4))==="RIFF"&&String.fromCharCode(...b.slice(8,12))==="WEBP"},
} as const;
function client(){
 const account=process.env.CLOUDFLARE_R2_ACCOUNT_ID,access=process.env.CLOUDFLARE_R2_ACCESS_KEY_ID,secret=process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
 if(!account||!access||!secret)throw new Error("R2 não configurado.");
 return new S3Client({region:"auto",endpoint:`https://${account}.r2.cloudflarestorage.com`,credentials:{accessKeyId:access,secretAccessKey:secret}});
}
function bucket(){const b=process.env.CLOUDFLARE_R2_BUCKET_NAME;if(!b)throw new Error("Bucket R2 não configurado.");return b;}
function productIdFrom(request:Request){const id=new URL(request.url).searchParams.get("productId")??"";if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id))throw new Error("Identificador do produto inválido.");return id;}
async function withProduct(request:Request,fn:(ctx:{tenant:string;user:string;db:any;id:string})=>Promise<Response>){
 let tx:any=null;
 try{
  const id=productIdFrom(request);tx=await beginAuthenticatedTransaction(request);const {accountId:tenant,userId:user,role,permissions}=tx.identity;
  if(role!=="manager"&&!(Array.isArray(permissions)&&permissions.includes("Gerência"))){await releaseTransaction(tx.client,false);tx=null;return Response.json({ok:false,error:"Somente a Gerência pode alterar fotos."},{status:403});}
  const db=tx.client;const found=await db.query("SELECT id,photo_object_key,version FROM public.products WHERE tenant_id=$1 AND id=$2 FOR UPDATE",[tenant,id]);
  if(!found.rows.length){await releaseTransaction(db,false);tx=null;return Response.json({ok:false,error:"Produto não encontrado no catálogo da empresa."},{status:404});}
  const result=await fn({tenant,user,db,id});
  if(tx){await releaseTransaction(db,true);tx=null;}
  return result;
 }catch(e){
  if(tx)await releaseTransaction(tx.client,false).catch(()=>{});
  if(e instanceof ApiAuthError)return Response.json({ok:false,error:e.message,code:e.code},{status:e.status});
  console.error("[MobFlow product photo]",e instanceof Error?e.message:"unknown");
  return Response.json({ok:false,error:"Não foi possível concluir a operação da foto."},{status:500});
 }
}
async function upload(request:Request){
 return withProduct(request,async({tenant,user,db,id})=>{
  const form=await request.formData().catch(()=>null),file=form?.get("file");
  if(!(file instanceof File)||file.size<1||file.size>MAX_BYTES)return Response.json({ok:false,error:"Envie uma imagem de até 5 MB."},{status:400});
  const rule=formats[file.type as keyof typeof formats];if(!rule)return Response.json({ok:false,error:"Formato permitido: PNG, JPG ou WEBP."},{status:415});
  const bytes=new Uint8Array(await file.arrayBuffer());if(!rule.valid(bytes))return Response.json({ok:false,error:"O conteúdo não corresponde ao formato informado."},{status:415});
  const key=`tenants/${tenant}/products/${id}/${randomUUID()}.${rule.ext}`;
  const s3=client();const old=(await db.query("SELECT photo_object_key FROM public.products WHERE tenant_id=$1 AND id=$2",[tenant,id])).rows[0]?.photo_object_key as string|null;
  await s3.send(new PutObjectCommand({Bucket:bucket(),Key:key,Body:bytes,ContentType:file.type,ContentLength:bytes.length,CacheControl:"private, no-store",Metadata:{"mobflow-tenant":tenant,"mobflow-product":id,"mobflow-purpose":"product-photo"}}));
  try{
   const updated=await db.query("UPDATE public.products SET photo_object_key=$3,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING version",[tenant,id,key]);
   if(!updated.rows.length)throw new Error("Produto não encontrado.");
   await db.query("SELECT public.mobflow_append_sync_event($1::uuid,$2::uuid,'catalog','manual','product',$3,$4::jsonb)",[randomUUID(),randomUUID(),id,JSON.stringify({operation:"photo_updated",productId:id,photoObjectKey:key,version:Number(updated.rows[0].version)})]);
  }catch(e){await s3.send(new DeleteObjectCommand({Bucket:bucket(),Key:key})).catch(()=>{});throw e;}
  // A foto anterior é mantida até uma rotina de limpeza pós-commit confirmada.
  return Response.json({ok:true,photoObjectKey:key,photoUrl:`/api/mobflow/product-photo?productId=${encodeURIComponent(id)}`});
 });
}
async function read(request:Request){
 return withProduct(request,async({tenant,db,id})=>{
  const row=(await db.query("SELECT photo_object_key FROM public.products WHERE tenant_id=$1 AND id=$2",[tenant,id])).rows[0];
  const key=row?.photo_object_key as string|null;if(!key||!key.startsWith(`tenants/${tenant}/products/${id}/`))return new Response(null,{status:404});
  const object=await client().send(new GetObjectCommand({Bucket:bucket(),Key:key}));if(!object.Body)return new Response(null,{status:404});
  const bytes=await object.Body.transformToByteArray();
  return new Response(bytes,{headers:{"Content-Type":object.ContentType??"application/octet-stream","Content-Length":String(bytes.byteLength),"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Content-Security-Policy":"default-src 'none'; sandbox"}});
 });
}
async function remove(request:Request){
 return withProduct(request,async({tenant,db,id})=>{
  const row=(await db.query("SELECT photo_object_key FROM public.products WHERE tenant_id=$1 AND id=$2",[tenant,id])).rows[0];
  const old=row?.photo_object_key as string|null;if(!old)return Response.json({ok:true,removed:false});
  await db.query("UPDATE public.products SET photo_object_key=NULL,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",[tenant,id]);
  await db.query("SELECT public.mobflow_append_sync_event($1::uuid,$2::uuid,'catalog','manual','product',$3,$4::jsonb)",[randomUUID(),randomUUID(),id,JSON.stringify({operation:"photo_removed",productId:id,photoObjectKey:null})]);
  // O objeto antigo fica preservado; a remoção física ocorre somente após confirmação do commit.
  return Response.json({ok:true,removed:true});
 });
}
export const Route=createFileRoute("/api/mobflow/product-photo")({server:{handlers:{
 POST:({request})=>upload(request),
 GET:({request})=>read(request),
 DELETE:({request})=>remove(request),
}}});
