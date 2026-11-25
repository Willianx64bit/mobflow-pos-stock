import { describe, expect, it } from "vitest";
import { buildPixPayload, buildPixQrMatrix } from "@/lib/store";

function readEmvField(payload: string, wantedId: string): string | null {
  let cursor = 0;
  while (cursor + 4 <= payload.length) {
    const id = payload.slice(cursor, cursor + 2);
    const length = Number(payload.slice(cursor + 2, cursor + 4));
    const value = payload.slice(cursor + 4, cursor + 4 + length);
    if (!Number.isInteger(length) || value.length !== length) return null;
    if (id === wantedId) return value;
    cursor += 4 + length;
  }
  return null;
}

describe("Pix offline payload", () => {
  it("embeds the exact company key and sale amount without requiring a network request", () => {
    const key = "financeiro@empresa.com.br";
    const payload = buildPixPayload(key, 42.5, "Mercado Teste", "Capao Bonito");
    const merchantAccount = readEmvField(payload, "26");
    expect(merchantAccount).toContain(key);
    expect(readEmvField(payload, "54")).toBe("42.50");
    expect(payload).toMatch(/6304[0-9A-F]{4}$/);
  });

  it("does not produce a zero or negative payment amount", () => {
    const zeroPayload = buildPixPayload("12345678900", 0);
    const negativePayload = buildPixPayload("12345678900", -10);
    expect(readEmvField(zeroPayload, "54")).toBe("0.00");
    expect(readEmvField(negativePayload, "54")).toBe("0.00");
  });

  it("renders a non-empty QR matrix locally without a network request", () => {
    const payload = buildPixPayload("financeiro@empresa.com.br", 42.5, "Mercado Teste", "Capao Bonito");
    const qr = buildPixQrMatrix(payload);
    expect(qr.width).toBeGreaterThan(0);
    expect(qr.height).toBeGreaterThan(0);
    expect(qr.path).toMatch(/^M\d+ \d+h1v1h-1z/);
  });
});
