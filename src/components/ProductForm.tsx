import { useEffect, useRef, useState } from "react";
import { actions, type Product } from "@/lib/store";

type Props = { product?: Product | null; onClose: () => void };

export function ProductForm({ product, onClose }: Props) {
  const [f, setF] = useState({
    name: product?.name ?? "", code: product?.code ?? "", ref: product?.ref ?? "", category: product?.category ?? "",
    price: product ? String(product.price).replace(".", ",") : "", cost: product?.cost != null ? String(product.cost).replace(".", ",") : "",
    stock: product ? String(product.stock).replace(".", ",") : "", minStock: product ? String(product.minStock).replace(".", ",") : "5",
    unit: product?.unit ?? "un", photo: product?.photo ?? "",
  });
  const [barcodes, setBarcodes] = useState<string[]>(product?.barcodes ?? []);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    (product ? first.current : codeInput.current)?.focus();
  }, []);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const num=(s:string)=>Number(s.replace(",","."))||0;
  const cleanNumber=(value:string)=>{
    let v=value.replace(/[^0-9,\.]/g,"").replace(".",",");
    if(v.includes(",")) {
      const [a="",b=""]=v.split(",");
      v=(a.replace(/^0+(?=\d)/,"")||"0")+","+b.replace(/,/g,"");
    } else v=v.replace(/^0+(?=\d)/,"");
    return v;
  };
  const weight=(s:string)=>{const v=s.trim().toLowerCase().replace(",",".");if(/^\d+(?:\.\d+)?\s*g$/.test(v))return Number(v.replace(/g$/,"").trim())/1000;if(/^\d+(?:\.\d+)?\s*kg$/.test(v))return Number(v.replace(/kg$/,"").trim());if(/^\d+(?:\.\d+)?$/.test(v))return Number(v);return null;};

  const submit=async(e:React.FormEvent)=>{e.preventDefault();if(!f.name.trim()||photoBusy)return;const stock=f.unit==="kg"?weight(f.stock):num(f.stock),minStock=f.unit==="kg"?weight(f.minStock):num(f.minStock);if(f.unit==="kg"&&(stock===null||minStock===null||stock<0||minStock<0))return;
    setPhotoBusy(true);
    try {
      const id=product?.id??crypto.randomUUID();
      const code=f.code.trim()||String(Date.now()).slice(-10);
      const cleanBarcodes=Array.from(new Set(barcodes.map(value=>value.trim()).filter(value=>value&&value!==code)));
      if(!product?.id&&photoFile){
        if(import.meta.env.VITE_MOBFLOW_CATALOG_READ_PROVIDER!=="neon")throw new Error("O envio seguro de fotos exige o catálogo Neon habilitado neste ambiente.");
        if((stock??0)!==0)throw new Error("Para cadastrar com foto no catálogo Neon, salve primeiro o produto com estoque zero. O estoque inicial é registrado por uma operação auditável.");
        const create=await fetch("/api/mobflow/products",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id,code,name:f.name.trim(),ref:f.ref.trim()||null,category:f.category.trim()||"Geral",unit:f.unit,price:num(f.price),cost:f.cost.trim()?num(f.cost):0,stock:0,minStock:minStock??0,barcodes:cleanBarcodes})});
        const created=await create.json().catch(()=>null);if(!create.ok||!created?.ok)throw new Error(created?.error||"Não foi possível cadastrar o produto no catálogo.");
      }
      let photoUrl=f.photo||undefined;
      if(photoFile){
        const form=new FormData();form.append("file",photoFile);
        const response=await fetch("/api/mobflow/product-photo?productId="+encodeURIComponent(id),{method:"POST",body:form});
        const result=await response.json().catch(()=>null);if(!response.ok||!result?.ok)throw new Error(result?.error||"Não foi possível enviar a foto.");
        photoUrl=result.photoUrl;
      } else if(product?.id&&!f.photo&&product.photo){
        const response=await fetch("/api/mobflow/product-photo?productId="+encodeURIComponent(product.id),{method:"DELETE"});
        const result=await response.json().catch(()=>null);if(!response.ok||!result?.ok)throw new Error(result?.error||"Não foi possível remover a foto.");
        photoUrl=undefined;
      }
      actions.saveProduct({id,name:f.name.trim(),barcodes:cleanBarcodes,ref:f.ref.trim()||undefined,code,category:f.category.trim()||"Geral",price:num(f.price),cost:f.cost.trim()?num(f.cost):undefined,stock:f.unit==="kg"?stock!:Math.round(stock??0),minStock:f.unit==="kg"?minStock!:Math.round(minStock??0),unit:f.unit,photo:photoUrl,photoObjectKey:product?.photoObjectKey});onClose();
    } catch(error){alert(error instanceof Error?error.message:"Falha ao salvar foto do produto.");} finally {setPhotoBusy(false);} };

  const choosePhoto=(e:React.ChangeEvent<HTMLInputElement>)=>{const file=e.target.files?.[0];if(!file)return;if(file.size>5*1024*1024){alert("A foto deve ter no máximo 5 MB.");return;}if(!["image/png","image/jpeg","image/webp"].includes(file.type)){alert("Formato permitido: PNG, JPG ou WEBP.");return;}setPhotoFile(file);setF(v=>({...v,photo:URL.createObjectURL(file)}));};
  const input=(key:keyof typeof f,label:string,opts:{mono?:boolean;ref?:boolean;mode?:"decimal"|"numeric"}={})=><label className="flex flex-col gap-1.5"><span className="label-mono">{label}</span><input ref={opts.ref?first:undefined} inputMode={opts.mode} value={f[key]} onChange={e=>setF({...f,[key]:opts.mode==="decimal"?cleanNumber(e.target.value):e.target.value})} className={`field text-sm text-foreground ${opts.mono?"font-mono":""}`}/></label>;

  return <div className="fixed inset-0 z-50 grid place-items-center bg-background/70 backdrop-blur-sm p-4" onClick={onClose}><form onSubmit={submit} onClick={e=>e.stopPropagation()} className="mfb-in w-full max-w-md max-h-[92vh] overflow-y-auto rounded-2xl bg-popover ring-1 ring-border p-5 space-y-4">
    <div className="flex items-center justify-between gap-3"><button type="button" onClick={onClose} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-secondary-foreground ring-1 ring-border hover:bg-accent"><span aria-hidden="true">←</span> Voltar</button><h2 className="font-display text-xl tracking-[.08em] text-heading text-right">{product?"EDITAR PRODUTO":"NOVO PRODUTO"}</h2></div>
    <div className="flex items-center gap-4"><div className="h-20 w-20 shrink-0 overflow-hidden rounded-2xl bg-secondary ring-1 ring-border grid place-items-center">{f.photo?<img src={f.photo} alt="Foto do produto" className="h-full w-full object-cover"/>:<span className="text-2xl text-muted-foreground">📷</span>}</div><label className="flex-1 cursor-pointer"><span className="label-mono">Foto do produto</span><div className="mt-1.5 rounded-xl border border-dashed border-border px-3 py-3 text-sm text-secondary-foreground hover:bg-accent">Escolher foto <span className="text-xs text-muted-foreground">(até 5 MB)</span></div><input type="file" accept="image/*" onChange={choosePhoto} className="hidden"/></label>{f.photo&&<button type="button" onClick={()=>{setPhotoFile(null);setF(v=>({...v,photo:""}));}} className="self-end rounded-lg px-2 py-2 text-xs text-destructive hover:bg-destructive/10">Remover</button>}</div>
    {input("name","Nome",{ref:true})}
    <div className="grid grid-cols-2 gap-3"><div className="flex flex-col gap-1.5"><div className="flex items-center justify-between gap-2"><span className="label-mono">Código de barras</span><button type="button" onClick={()=>setBarcodes(v=>[...v,""])} aria-label="Adicionar outro código de barras" title="Adicionar outro código" className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-lg font-bold text-primary-foreground hover:bg-primary/85">+</button></div><input ref={codeInput} inputMode="numeric" value={f.code} onChange={e=>setF({...f,code:e.target.value.replace(/\D/g,"")})} onKeyDown={e=>{if(e.key==="Enter" && f.code.trim()){e.preventDefault();e.currentTarget.form?.requestSubmit();}}} className="field text-sm text-foreground font-mono"/>{barcodes.map((barcode,index)=><div key={index} className="flex items-center gap-2"><input inputMode="numeric" value={barcode} onChange={e=>setBarcodes(v=>v.map((code,i)=>i===index?e.target.value.replace(/\D/g,""):code))} placeholder={`Código alternativo ${index+1}`} className="field min-w-0 flex-1 text-sm text-foreground font-mono"/><button type="button" onClick={()=>setBarcodes(v=>v.filter((_,i)=>i!==index))} aria-label={`Remover código alternativo ${index+1}`} title="Remover código" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-destructive hover:bg-destructive/10">×</button></div>)}</div>{input("ref","REF (opcional)",{mono:true})}</div>
    {input("category","Categoria")}
    <label className="flex flex-col gap-1.5"><span className="label-mono">Tipo de venda</span><select value={f.unit} onChange={e=>setF({...f,unit:e.target.value as "un"|"kg"})} className="field text-sm text-foreground"><option value="un">Unidade</option><option value="kg">Peso (kg/g)</option></select></label>
    <div className="grid grid-cols-2 gap-3">{input("price",f.unit==="kg"?"Preço por kg R$":"Preço R$",{mono:true,mode:"decimal"})}{input("cost",f.unit==="kg"?"Custo por kg R$":"Custo R$ (opcional)",{mono:true,mode:"decimal"})}</div>
    <div className="grid grid-cols-2 gap-3">{input("stock",f.unit==="kg"?"Estoque (kg ou g)":"Estoque",{mono:true,mode:"decimal"})}{input("minStock",f.unit==="kg"?"Mínimo (kg ou g)":"Mínimo",{mono:true,mode:"decimal"})}</div>
    {f.unit==="kg"&&<p className="font-mono text-[10px] text-primary">Produto por peso: 2 = 2 kg, 500g = 0,5 kg. O preço é por kg.</p>}
    <div className="flex gap-2 pt-1">{product&&<button type="button" onClick={()=>{if(confirm("Excluir este produto?")){actions.deleteProduct(product.id);onClose();}}} className="rounded-xl px-4 py-3 text-sm font-semibold text-destructive ring-1 ring-destructive/40 hover:bg-destructive/10">Excluir</button>}<button type="submit" className="flex-1 rounded-xl bg-primary text-primary-foreground font-bold py-3 hover:bg-primary/85">{photoBusy?"Enviando foto...":"Salvar"} <kbd className="font-mono text-[11px] opacity-70">↵</kbd></button></div>
  </form></div>;
}