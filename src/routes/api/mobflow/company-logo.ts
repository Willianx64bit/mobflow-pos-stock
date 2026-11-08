import { createFileRoute } from "@tanstack/react-router";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import { beginAuthenticatedTransaction, ApiAuthError } from "@/lib/server/mobflow-auth";
import { releaseTransaction } from "@/lib/server/neon";

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const allowed = {
  "image/png": { ext: "png", signature: (b: Uint8Array) => b.length >= 8 && [137,80,78,71,13,10,26,10].every((v,i)=>b[i]===v) },
  "image/jpeg": { ext: "jpg", signature: (b: Uint8Array) => b.length >= 3 && b[0]===255 && b[1]===216 && b[2]===255 },
  "image/webp": { ext: "webp", signature: (b: Uint8Array) => b.length >= 12 && String.fromCharCode(...b.slice(0,4))==="RIFF" && String.fromCharCode(...b.slice(8,12))==="WEBP" },
} as const;

function r2() {
  const accountId=process.env.CLOUDFLARE_R2_ACCOUNT_ID;
  const accessKeyId=process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
  const secretAccessKey=process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
  if(!accountId||!accessKeyId||!secretAccessKey) throw new Error("R2 não configurado.");
  return new S3Client({region:"auto",endpoint:`https://${accountId}.r2.cloudflarestorage.com`,credentials:{accessKeyId,secretAccessKey}});
}
function bucket(){const value=process.env.CLOUDFLARE_R2_BUCKET_NAME;if(!value)throw new Error("Bucket R2 não configurado.");return value;}
function keyFor(tenant:string,ext:string){return `tenants/${tenant}/company-logos/logo.${ext}`;}
function validKey(key:string,tenant:string){return new RegExp(`^tenants/${tenant}/company-logos/logo\\.(png|jpg|webp)$`).test(key);}
async function withIdentity(request:Request, action:(tenant:string)=>Promise<Response>){
 let tx:any=null;
 try{
  tx=await beginAuthenticatedTransaction(request);
  if(tx.identity.role!=="manager") return Response.json({ok:false,error:"Somente a gerência pode alterar a logo da empresa."},{status:403});
  const tenant=tx.identity.accountId;
  await releaseTransaction(tx.client,true);tx=null;
  return await action(tenant);
 }catch(error){
  if(tx)await releaseTransaction(tx.client,false).catch(()=>{});
  if(error instanceof ApiAuthError)return Response.json({ok:false,error:error.message},{status:error.status});
  console.error("[MobFlow company logo]",error instanceof Error?error.message:"unknown error");
  return Response.json({ok:false,error:"Não foi possível acessar a logo da empresa."},{status:500});
 }
}
async function upload(request:Request){
 return withIdentity(request,async tenant=>{
  const form=await request.formData().catch(()=>null),file=form?.get("file");
  if(!(file instanceof File)||file.size<1||file.size>MAX_LOGO_BYTES)return Response.json({ok:false,error:"Envie uma imagem de até 2 MB."},{status:400});
  const rule=allowed[file.type as keyof typeof allowed];
  if(!rule)return Response.json({ok:false,error:"Formato permitido: PNG, JPG ou WEBP."},{status:415});
  const bytes=new Uint8Array(await file.arrayBuffer());
  if(!rule.signature(bytes))return Response.json({ok:false,error:"O conteúdo do arquivo não corresponde ao formato informado."},{status:415});
  const key=keyFor(tenant,rule.ext);
  await r2().send(new PutObjectCommand({Bucket:bucket(),Key:key,Body:bytes,ContentType:file.type,ContentLength:bytes.length,CacheControl:"private, max-age=300",Metadata:{"mobflow-tenant":tenant,"mobflow-purpose":"company-logo","mobflow-upload-id":randomUUID()}}));
  return Response.json({ok:true,objectKey:key});
 });
}
async function read(request:Request){
 return withIdentity(request,async tenant=>{
  const key=new URL(request.url).searchParams.get("key")??"";
  if(!validKey(key,tenant))return Response.json({ok:false,error:"Referência de logo inválida."},{status:400});
  const result=await r2().send(new GetObjectCommand({Bucket:bucket(),Key:key}));
  if(!result.Body)return new Response(null,{status:404});
  const bytes=await result.Body.transformToByteArray();
  return new Response(bytes,{headers:{"Content-Type":result.ContentType??"application/octet-stream","Content-Length":String(bytes.byteLength),"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
 });
}
async function remove(request:Request){
 return withIdentity(request,async tenant=>{
  const key=new URL(request.url).searchParams.get("key")??"";
  if(!validKey(key,tenant))return Response.json({ok:false,error:"Referência de logo inválida."},{status:400});
  await r2().send(new DeleteObjectCommand({Bucket:bucket(),Key:key}));
  return Response.json({ok:true});
 });
}
export const Route=createFileRoute("/api/mobflow/company-logo")({server:{handlers:{
 POST:({request})=>upload(request),
 GET:({request})=>read(request),
 DELETE:({request})=>remove(request),
}}});
