import { useEffect, useRef, useState } from "react";

export function CameraScanner({ onCode, onClose, title = "Leitor de código" }: { onCode: (code: string) => void; onClose: () => void; title?: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState("");
  const [last, setLast] = useState("");
  const cb = useRef(onCode);
  cb.current = onCode;

  useEffect(() => {
    let stop: (() => void) | undefined;
    let lastCode = "";
    let lastAt = 0;
    let cancelled = false;
    (async () => {
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        const reader = new BrowserMultiFormatReader();
        const controls = await reader.decodeFromConstraints(
          { video: { facingMode: "environment" } },
          video.current!,
          (result) => {
            if (!result) return;
            const code = result.getText();
            const now = Date.now();
            if (code === lastCode && now - lastAt < 1500) return;
            lastCode = code; lastAt = now;
            setLast(code);
            navigator.vibrate?.(80);
            cb.current(code);
          },
        );
        if (cancelled) controls.stop(); else stop = () => controls.stop();
      } catch {
        setErr("Não foi possível abrir a câmera. Verifique a permissão do navegador.");
      }
    })();
    return () => { cancelled = true; stop?.(); };
  }, []);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="mfb-in w-full max-w-md rounded-2xl bg-popover ring-1 ring-primary/40 p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <span className="font-display text-xl tracking-[.12em] text-heading">{title.toUpperCase()}</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl" aria-label="Fechar">×</button>
        </div>
        <div className="relative rounded-xl overflow-hidden ring-1 ring-border bg-surface aspect-[4/3]">
          <video ref={video} className="w-full h-full object-cover" muted playsInline />
          <div className="absolute inset-x-8 top-1/2 h-0.5 bg-primary/80" />
        </div>
        {err ? <p className="mt-3 text-sm text-destructive">{err}</p> : (
          <p className="mt-3 font-mono text-[11px] text-muted-foreground">aponte para o código de barras · {last ? <span className="text-primary">lido: {last}</span> : "aguardando…"}</p>
        )}
        <button onClick={onClose} className="mt-3 w-full rounded-xl bg-primary text-primary-foreground font-bold py-3">Concluir</button>
      </div>
    </div>
  );
}
