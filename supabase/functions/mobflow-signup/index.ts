import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// MobFlow signup: existing accounts and manual payment approval must remain unchanged.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const cleanDigits = (value: unknown) => String(value ?? "").replace(/\D/g, "");
const normalizeUsername = (value: unknown) => String(value ?? "").trim().toUpperCase();
const tlv = (id: string, value: string) => id + String(value.length).padStart(2, "0") + value;
const crc16 = (input: string) => {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
};
const buildPixPayload = (key: string, name: string, city: string, amount: number) => {
  const cleanName = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z0-9 .&-]/gi, "").toUpperCase().slice(0, 25) || "MOBFLOW";
  const cleanCity = city.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z0-9 .-]/gi, "").toUpperCase().slice(0, 15) || "SAO PAULO";
  const merchant = tlv("00", "BR.GOV.BCB.PIX") + tlv("01", key);
  const additional = tlv("05", "***");
  const payload = tlv("00", "01") + tlv("01", "12") + tlv("26", merchant) + tlv("52", "0000") + tlv("53", "986") +
    tlv("54", amount.toFixed(2)) + tlv("58", "BR") + tlv("59", cleanName) + tlv("60", cleanCity) + tlv("62", additional) + "6304";
  return payload + crc16(payload);
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);
  return json({ error: "Esta versão de segurança é apenas uma tentativa de gravação; nenhum cadastro foi alterado." }, 503);
});