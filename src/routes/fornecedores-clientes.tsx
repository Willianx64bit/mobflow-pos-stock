import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { actions, useStore, type BusinessContact } from "@/lib/store";
import { ArrowLeft, Plus, Search, Trash2, Users, Truck } from "lucide-react";

export const Route = createFileRoute("/fornecedores-clientes")({
  head: () => ({ meta: [{ title: "MobFlow — Fornecedores e Clientes" }] }),
  component: FornecedoresClientes,
});

const blank = (type: BusinessContact["type"]): Omit<BusinessContact, "id"> => ({ type, name: "", document: "", phone: "", cep: "", street: "", number: "", neighborhood: "", city: "", state: "" });

function FornecedoresClientes() {
  const navigate = useNavigate();
  const contacts = useStore(s => s.contacts ?? []);
  const [type, setType] = useState<BusinessContact["type"]>("Fornecedor");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<BusinessContact | null>(null);
  const [form, setForm] = useState<Omit<BusinessContact, "id">>(blank("Fornecedor"));
  const [showForm, setShowForm] = useState(false);
  const filtered = useMemo(() => contacts.filter(c => c.type === type && (!search.trim() || [c.name,c.document,c.phone].some(v => (v ?? "").toLowerCase().includes(search.trim().toLowerCase())))), [contacts,type,search]);
  const startNew = () => { setEditing(null); setForm(blank(type)); setShowForm(true); };
  const edit = (c: BusinessContact) => { setEditing(c); setForm({ type: c.type, name: c.name, document: c.document ?? "", phone: c.phone ?? "", cep: c.cep ?? "", street: c.street ?? "", number: c.number ?? "", neighborhood: c.neighborhood ?? "", city: c.city ?? "", state: c.state ?? "" }); setShowForm(true); };
  const save = (e: React.FormEvent) => { e.preventDefault(); if (!form.name.trim()) return; actions.saveContact({ ...form, type, ...(editing ? { id: editing.id } : {}) }); setShowForm(false); setEditing(null); };
  const field = (key: keyof Omit<BusinessContact,"id"|"type">, label: string, placeholder = label) => <label className="block space-y-1 text-sm font-medium" key={key}><span>{label}</span><input value={form[key] ?? ""} onChange={e => setForm(v => ({ ...v, [key]: e.target.value }))} placeholder={placeholder} className="field w-full" /></label>;
  return <div className="mfb-in min-h-screen p-4 md:p-6"><AppHeader /><main className="mx-auto max-w-5xl space-y-5 pt-12">
    <section className="glass p-5 md:p-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><button onClick={() => navigate({to:"/operacoes"})} className="mb-3 inline-flex items-center gap-2 rounded-xl bg-secondary px-3 py-2 text-sm font-semibold"><ArrowLeft className="h-4 w-4"/> Operações</button><h1 className="font-display text-2xl font-extrabold text-heading md:text-3xl">FORNECEDORES E CLIENTES</h1><p className="mt-1 text-sm text-muted-foreground">Cadastre os dados uma vez e reutilize no recebimento e nas doações.</p></div><button onClick={startNew} className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-3 font-bold text-primary-foreground"><Plus className="h-4 w-4"/> Novo</button></div>
      <div className="mt-5 grid grid-cols-2 gap-3"><button onClick={() => {setType("Fornecedor");setSearch("");setShowForm(false)}} className={`rounded-xl border p-4 text-left transition ${type==="Fornecedor"?"border-primary bg-primary/10":"border-border bg-background"}`}><Truck className="mb-2 h-6 w-6"/><div className="font-bold">Fornecedores</div><div className="text-sm text-muted-foreground">{contacts.filter(c=>c.type==="Fornecedor").length} cadastrados</div></button><button onClick={() => {setType("Cliente");setSearch("");setShowForm(false)}} className={`rounded-xl border p-4 text-left transition ${type==="Cliente"?"border-primary bg-primary/10":"border-border bg-background"}`}><Users className="mb-2 h-6 w-6"/><div className="font-bold">Clientes</div><div className="text-sm text-muted-foreground">{contacts.filter(c=>c.type==="Cliente").length} cadastrados</div></button></div>
    </section>
    {showForm && <form onSubmit={save} className="glass space-y-4 p-5"><h2 className="text-lg font-bold">{editing ? "Editar" : "Novo"} {type === "Fornecedor" ? "fornecedor" : "cliente"}</h2><div className="grid gap-3 sm:grid-cols-2">{field("name","Nome")}{field("document","CPF/CNPJ")}{field("phone","Telefone")}{field("cep","CEP")}{field("street","Endereço")}{field("number","Número")}{field("neighborhood","Bairro")}{field("city","Cidade")}{field("state","UF")}</div><div className="flex gap-2"><button type="button" onClick={()=>setShowForm(false)} className="rounded-xl bg-secondary px-4 py-3 font-semibold">Cancelar</button><button type="submit" className="flex-1 rounded-xl bg-primary px-4 py-3 font-bold text-primary-foreground">Salvar cadastro</button></div></form>}
    <section className="glass p-4 md:p-5"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-bold">{type === "Fornecedor" ? "Fornecedores cadastrados" : "Clientes cadastrados"}</h2><div className="relative w-full sm:max-w-xs"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar por nome, CPF/CNPJ ou telefone" className="field w-full pl-9"/></div></div>
      {filtered.length===0 ? <p className="rounded-xl bg-secondary/50 p-6 text-center text-sm text-muted-foreground">Nenhum {type.toLowerCase()} encontrado. Use “Novo” para cadastrar.</p> : <div className="space-y-3">{filtered.map(c=><article key={c.id} className="rounded-xl border border-border bg-background p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-bold text-heading">{c.name}</h3><p className="mt-1 text-sm text-muted-foreground">{[c.document,c.phone].filter(Boolean).join(" · ") || "Sem CPF/CNPJ ou telefone"}</p><p className="mt-1 text-sm text-muted-foreground">{[c.street,c.number,c.neighborhood,c.city,c.state,c.cep].filter(Boolean).join(", ") || "Endereço não informado"}</p></div><div className="flex gap-2"><button onClick={()=>edit(c)} className="rounded-lg bg-secondary px-3 py-2 text-sm font-semibold">Editar</button><button onClick={()=>{if(window.confirm("Excluir este cadastro?")) actions.deleteContact(c.id)}} className="rounded-lg bg-destructive/10 p-2 text-destructive" aria-label="Excluir"><Trash2 className="h-4 w-4"/></button></div></div></article>)}</div>}
    </section>
  </main></div>;
}
