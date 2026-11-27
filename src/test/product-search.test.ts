import { describe, expect, it } from "vitest";
import { buildLocalProductSearchIndex, buildProductBarcodeIndex, searchIndexedLocalProducts, searchLocalProducts } from "@/lib/product-search";
import type { Product } from "@/lib/store";

const product = (id: string, name: string, code: string, barcodes: string[] = []): Product => ({
  id, name, code, barcodes, price: 10, cost: 5, stock: 4, minStock: 1, category: "Mercearia", unit: "un", active: true,
});

describe("local PDV product search",()=>{
  it("builds direct code and barcode lookups while preferring the fresh Neon supplement",()=>{
    const local=product("local-1","Arroz","001",["7890001"]);
    const remote=product("remote-1","Arroz remoto","001",["7890001"]);
    const index=buildProductBarcodeIndex([local],[remote]);
    expect(index.get("001")?.id).toBe("remote-1");
    expect(index.get("7890001")?.id).toBe("remote-1");
  });
  it("returns at most 100 local matches from a 100k product catalog",()=>{
    const products:Product[]=Array.from({length:100_000},(_,i)=>product(
      `p-${i}`,
      i%2===0?`Arroz tipo ${i}`:`Produto ${i}`,
      String(i).padStart(8,"0"),
    ));
    const lastProduct = products[99_999]!;
    products[99_999] = { ...lastProduct, barcodes:["789000099999"] };
    const index=buildLocalProductSearchIndex(products);
    const matches=searchIndexedLocalProducts(index,"arroz",100);
    expect(matches).toHaveLength(100);
    expect(matches.every((item)=>item.name.toLocaleLowerCase("pt-BR").includes("arroz"))).toBe(true);
    expect(buildProductBarcodeIndex(products).get("789000099999")?.id).toBe("p-99999");
  });
  it("matches accented product names with an unaccented query",()=>{
    const products=[product("sugar","Açúcar refinado","123")];
    expect(searchLocalProducts(products,"acucar")).toMatchObject([{id:"sugar"}]);
  });
  it("shows only the first 100 catalog products when the search is empty",()=>{
    const products=Array.from({length:250},(_,i)=>product(`p-${i}`,`Produto ${i}`,String(i)));
    expect(searchLocalProducts(products,"")).toHaveLength(100);
  });
});
