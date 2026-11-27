// @lovable.dev/vite-tanstack-config already includes the Vite, React, Tailwind,
// TanStack Start, Nitro, and path-alias plugins. Keep the normal web build unchanged.
// The Windows EXE build emits a client-only SPA shell that Electron serves locally.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

const isDesktopBuild = process.env["MOBFLOW_DESKTOP_BUILD"] === "1";

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
    ...(isDesktopBuild ? { spa: { enabled: true } } : {}),
  },
});
