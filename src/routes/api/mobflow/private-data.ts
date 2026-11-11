import { randomUUID } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { beginAuthenticatedTransaction, jsonError } from "@/lib/server/mobflow-auth";
import { releaseTransaction } from "@/lib/server/neon";

const contactFields = ["id","type","name","document","phone","cep","street","number","neighborhood","city","state"] as const;
const settingsFields = ["companyName","companyCnpj","companyPhone","companyStreet","companyNumber","companyCep","companyComplement","companyNeighborhood","companyCity","companyState","companyLogoObjectKey","pixKey","pixKeyType"] as const;
const text = (value: unknown, max = 240) => typeof value === "string" ? value.trim().slice(0,max) : "";
const object = (value: unknown): Record<string,unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string,unknown> : null;
function responseError(error: unknown) { return jsonError(error); }

async function handle(request: Request, method: "GET" | "PATCH" | "DELETE") {
 let tx: Awaited<ReturnType<typeof beginAuthenticatedTransaction>> | null = null;
 try {
  tx = await beginAuthenticatedTransaction(request);
  const {client,identity} = tx;
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") ?? "";
  const id = url.searchParams.get("id") ?? "";
  const row = await client.query<{state:Record<string,unknown>}>("SELECT state FROM public.app_state WHERE owner_id=$1" + (method === "GET" ? "" : " FOR UPDATE"),[identity.accountId]);
  const state = row.rows[0]?.state;
  if (!state || typeof state !== "object") { await releaseTransaction(client,false);tx=null;return Response.json({ok:false,error:"Dados da empresa não encontrados."},{status:404}); }
  const contacts = Array.isArray(state.contacts) ? state.contacts as Array<Record<string,unknown>> : [];
  const settings = object(state["settings"]) ?? {companyName:""};
  const permissions = Array.isArray(identity.permissions) ? identity.permissions : [];
  const canManageContacts = identity.role === "manager" || (identity.role === "pdv" && (permissions.includes("Cadastros") || permissions.includes("Gerência")));
  const canManageSettings = identity.role === "manager" || (identity.role === "pdv" && (permissions.includes("Configurações") || permissions.includes("Gerência")));
  if (method === "GET") {
   if (kind === "contacts") { const ids=contacts.map((item)=>text(item["id"],100)).filter(Boolean);await releaseTransaction(client,true);tx=null;return Response.json({ok:true,ids}); }
   if (kind === "contact" && id) { const contact=contacts.find((item)=>item["id"]===id);await releaseTransaction(client,true);tx=null;return contact?Response.json({ok:true,record:contact}):Response.json({ok:false,error:"Cadastro não encontrado."},{status:404}); }
   if (kind === "settings") { await releaseTransaction(client,true);tx=null;return Response.json({ok:true,record:settings}); }
   await releaseTransaction(client,false);tx=null;return Response.json({ok:false,error:"Tipo de dado inválido."},{status:400});
  }
  const canManage = kind === "contact" ? canManageContacts : kind === "settings" ? canManageSettings : false;
  if (!canManage) { await releaseTransaction(client,false);tx=null;return Response.json({ok:false,error:"Sem permissão para alterar estes dados."},{status:403}); }
  if (method === "DELETE") {
   if(kind!=="contact"||!id){await releaseTransaction(client,false);tx=null;return Response.json({ok:false,error:"Cadastro inválido."},{status:400});}
   const nextContacts=contacts.filter((item)=>item["id"]!==id);
   if(nextContacts.length===contacts.length){await releaseTransaction(client,false);tx=null;return Response.json({ok:false,error:"Cadastro não encontrado."},{status:404});}
   await client.query("UPDATE public.app_state SET state=jsonb_set(state,'{contacts}',$2::jsonb,true),updated_at=now() WHERE owner_id=$1",[identity.accountId,JSON.stringify(nextContacts)]);
   await client.query("SELECT public.mobflow_append_sync_event($1::uuid,$2::uuid,'master_data','manual','business_contact',$3,$4::jsonb)",[randomUUID(),randomUUID(),id,JSON.stringify({operation:"delete",privateDetailsAvailable:true})]);
   await releaseTransaction(client,true);tx=null;return Response.json({ok:true});
  }
  const body=object(await request.json().catch(()=>null));
  const value=object(body?.["value"]);
  if(!value){await releaseTransaction(client,false);tx=null;return Response.json({ok:false,error:"Dados inválidos."},{status:400});}
  if(kind==="contact"){
   const contactId=text(body?.id??value.id,100);
   const type=value["type"];
   const name=text(value["name"],160);
   if(!contactId||!name||(type!=="Cliente"&&type!=="Fornecedor")){await releaseTransaction(client,false);tx=null;return Response.json({ok:false,error:"Nome, tipo ou identificador inválido."},{status:400});}
   const record:Record<string,unknown>={id:contactId,type,name};
   for(const field of contactFields){if(field==="id"||field==="type"||field==="name")continue;if(value[field]!==undefined)record[field]=text(value[field],field==="document"?24:180)||undefined;}
   const index=contacts.findIndex((item)=>item["id"]===contactId);
   const nextContacts=index<0?[record,...contacts]:contacts.map((item,i)=>i===index?record:item);
   await client.query("UPDATE public.app_state SET state=jsonb_set(state,'{contacts}',$2::jsonb,true),updated_at=now() WHERE owner_id=$1",[identity.accountId,JSON.stringify(nextContacts)]);
   await client.query("SELECT public.mobflow_append_sync_event($1::uuid,$2::uuid,'master_data','manual','business_contact',$3,$4::jsonb)",[randomUUID(),randomUUID(),contactId,JSON.stringify({operation:"upsert",metadata:{type},privateDetailsAvailable:true})]);
   await releaseTransaction(client,true);tx=null;return Response.json({ok:true,record});
  }
  if(kind==="settings"){
   const next={...settings};
   for(const field of settingsFields){if(value[field]!==undefined){const val=value[field];next[field]=typeof val==="string"?val.trim().slice(0,500):val;}}
   if(next.pixKeyType!==undefined&&!["telefone","cpf","cnpj","email","aleatoria"].includes(String(next.pixKeyType))) {await releaseTransaction(client,false);tx=null;return Response.json({ok:false,error:"Tipo de chave Pix inválido."},{status:400});}
   await client.query("UPDATE public.app_state SET state=jsonb_set(state,'{settings}',$2::jsonb,true),updated_at=now() WHERE owner_id=$1",[identity.accountId,JSON.stringify(next)]);
   await client.query("SELECT public.mobflow_append_sync_event($1::uuid,$2::uuid,'settings','manual','company_settings','company',$3::jsonb)",[randomUUID(),randomUUID(),JSON.stringify({operation:"changed",privateOnly:true,keys:Object.keys(value).filter((key)=>settingsFields.includes(key as typeof settingsFields[number]))})]);
   await releaseTransaction(client,true);tx=null;return Response.json({ok:true,record:next});
  }
  await releaseTransaction(client,false);tx=null;return Response.json({ok:false,error:"Tipo de dado inválido."},{status:400});
 } catch(error) {
  if(tx) await releaseTransaction(tx.client,false).catch(()=>undefined);
  return responseError(error);
 }
}

export const Route = createFileRoute("/api/mobflow/private-data")({
 server:{handlers:{
  GET:({request})=>handle(request,"GET"),
  PATCH:({request})=>handle(request,"PATCH"),
  DELETE:({request})=>handle(request,"DELETE"),
 }}
});
