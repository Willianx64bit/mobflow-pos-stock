import { createFileRoute } from "@tanstack/react-router";
import { AppHeader } from "@/components/AppHeader";
import { useStore } from "@/lib/store";
export const Route = createFileRoute("/validade")({
  head: () => ({ meta: [{ title: "MobFlow — Validade dos produtos" }, { name: "description", content: "Produtos recebidos com validade cadastrada." }] }),
  component: ValidadeProdutos,
});
function ValidadeProdutos() {
  const notes = useStore((s) => s.receiving ?? []);
  const products = useStore((s) => s.products);
  const entries = notes.flatMap((note) => note.items.filter((item) => !!item.expiry).map((item) => ({ ...item, noteNumber: note.number, supplier: note.supplier })));
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const status = (expiry: string) => { const [day, month, year] = expiry.split("/").map(Number); const date = new Date(year, month - 1, day); date.setHours(0,0,0,0); const days = Math.ceil((date.getTime()-today.getTime())/86400000); return days < 0 ? {label:"Vencido",cls:"text-destructive bg-destructive/10"} : days <= 30 ? {label:"Vence em breve",cls:"text-amber-700 bg-amber-500/10 dark:text-amber-300"} : {label:"Dentro da validade",cls:"text-primary bg-primary/10"}; };
  entries.sort((a,b)=>{const parse=(v:string)=>{const[d,m,y]=v.split("/").map(Number);return new Date(y,m-1,d).getTime()};return parse(a.expiry!)-parse(b.expiry!)});
  return <div className="mfb-in min-h-screen p-4 md:p-6"><AppHeader/><section className="glass p-4"><div className="font-display text-2xl tracking-[.12em] text-heading mb-1">VALIDADE DOS PRODUTOS</div><div className="label-mono mb-4">Produtos com validade informada durante a conferência</div>{!entries.length&&<p className="py-10 text-center text-sm text-muted-foreground">Nenhum produto com validade cadastrada ainda.</p>}<div className="space-y-3">{entries.map((item,index)=>{const p=products.find(x=>x.id===item.productId);const st=status(item.expiry!);return <div key={item.productId+item.noteNumber+index} className="rounded-xl ring-1 ring-border p-3"><div className="flex items-start gap-3">{p?.photo?<img src={p.photo} alt="" className="h-12 w-12 rounded-lg object-cover ring-1 ring-border"/>:<div className="h-12 w-12 rounded-lg bg-secondary grid place-items-center text-xs text-muted-foreground">Sem foto</div>}<div className="min-w-0 flex-1"><div className="font-semibold text-foreground">{item.name}</div><div className="font-mono text-[11px] text-muted-foreground">{p?.code||item.productId}</div><div className="mt-2 text-sm">Validade: <b>{item.expiry}</b></div><div className="text-xs text-muted-foreground">NF {item.noteNumber} · {item.supplier}</div></div><span className={`shrink-0 rounded-md px-2 py-1 text-[10px] font-semibold ${st.cls}`}>{st.label}</span></div><div className="mt-3 text-xs text-muted-foreground">Quantidade recebida: {item.received??0} {item.unit==="kg"?"kg":"un."}</div></div>})}</div></section></div>;
}