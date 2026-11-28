import { describe, expect, it } from "vitest";
import { parseImportRows } from "@/components/ImportProducts";

describe("importação de produtos por planilha", () => {
  it("aceita somente código de barras e descrição e define estoque inicial zero", () => {
    const parsed = parseImportRows([
      { "Código de barras": "0012345678905", Descrição: "Arroz 5kg" },
    ]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toEqual([{ code: "0012345678905", name: "Arroz 5kg", qty: 0 }]);
  });

  it("normaliza código numérico sem casas decimais e preserva zeros em texto", () => {
    const parsed = parseImportRows([
      { Código: 1234567890123, Nome: "Produto numérico" },
      { Código: "0001234567890", Nome: "Produto com zero à esquerda" },
      { Código: "12345,00", Descrição: "Código exportado com decimal zero" },
    ]);
    expect(parsed.rows.map((row) => row.code)).toEqual(["1234567890123", "0001234567890", "12345"]);
    expect(parsed.rows.every((row) => row.qty === 0)).toBe(true);
  });

  it("informa código ou descrição ausente e ignora códigos repetidos", () => {
    const parsed = parseImportRows([
      { Código: "", Descrição: "Sem código" },
      { Código: "123", Descrição: "" },
      { Código: "456", Descrição: "Primeiro" },
      { Código: "456", Descrição: "Duplicado" },
    ]);
    expect(parsed.rows).toEqual([{ code: "456", name: "Primeiro", qty: 0 }]);
    expect(parsed.errors).toHaveLength(3);
  });
});
