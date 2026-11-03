// Production server for the TanStack Start build: static client assets from
// dist/client, everything else through the app's fetch handler (which adds
// the security headers). Run `pnpm build` first.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { serve } from "srvx";
import { staticMiddleware } from "srvx/static";

const serverEntry = new URL("../dist/server/server.js", import.meta.url);
if (!existsSync(serverEntry)) {
  console.error("No production build found. Run `pnpm --filter @promenadis/web build` first.");
  process.exit(1);
}
const { default: app } = await import(serverEntry.href);

serve({
  fetch: (request) => app.fetch(request),
  hostname: process.env.HOST ?? "127.0.0.1",
  middleware: [
    staticMiddleware({ dir: fileURLToPath(new URL("../dist/client", import.meta.url)) }),
  ],
  port: Number(process.env.PORT ?? 3000),
});
