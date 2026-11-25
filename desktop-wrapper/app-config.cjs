// The desktop app uses the official MobFlow PDV domain. Offline-only behavior remains gated by the desktop runtime.
const DEFAULT_APP_URL = "https://mobflow-pdv-gestao.vercel.app/";

function resolveAppUrl(value = process.env.MOBFLOW_APP_URL || DEFAULT_APP_URL) {
  let parsed;
  try {
    parsed = new URL(String(value).trim());
  } catch {
    throw new Error("MOBFLOW_APP_URL precisa ser uma URL HTTPS válida.");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("MOBFLOW_APP_URL precisa usar HTTPS.");
  }
  if (parsed.hostname !== "mobflow-pdv-gestao.vercel.app") {
    throw new Error("O MobFlow Desktop deve apontar para o domínio oficial do PDV.");
  }

  parsed.pathname = parsed.pathname.endsWith("/") ? parsed.pathname : parsed.pathname + "/";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

const APP_URL = resolveAppUrl();
const APP_ORIGIN = new URL(APP_URL).origin;

module.exports = { APP_URL, APP_ORIGIN, resolveAppUrl };
