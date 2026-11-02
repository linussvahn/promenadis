// Serves the production build at http://127.0.0.1:4173 with the same `/api`
// proxy as the dev server, so service-worker and offline behaviour can be
// checked against real built assets. Local use only; run `pnpm build` first.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import http from "node:http";

const PUBLIC_PORT = 4173;
const APP_PORT = 4174;
const API_TARGET = { host: "127.0.0.1", port: 54321, prefix: "/functions/v1/api-v1/browser" };

if (!existsSync(new URL("../build/server/index.js", import.meta.url))) {
  console.error("No production build found. Run `pnpm --filter @promenadis/web build` first.");
  process.exit(1);
}

// Run the server binary directly so stopping this script stops it too.
const app = spawn(
  process.execPath,
  ["node_modules/@react-router/serve/bin.cjs", "./build/server/index.js"],
  {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(APP_PORT) },
    stdio: "inherit",
  },
);

function forward(request, response, target) {
  const upstream = http.request(
    {
      headers: { ...request.headers, host: `${target.host}:${target.port}` },
      host: target.host,
      method: request.method,
      path: target.path,
      port: target.port,
    },
    (reply) => {
      response.writeHead(reply.statusCode ?? 502, reply.headers);
      reply.pipe(response);
    },
  );
  upstream.on("error", () => {
    if (!response.headersSent) response.writeHead(502);
    response.end();
  });
  request.pipe(upstream);
}

const server = http.createServer((request, response) => {
  const url = request.url ?? "/";
  if (url === "/api" || url.startsWith("/api/")) {
    forward(request, response, {
      host: API_TARGET.host,
      path: API_TARGET.prefix + url.slice("/api".length),
      port: API_TARGET.port,
    });
  } else {
    forward(request, response, { host: "127.0.0.1", path: url, port: APP_PORT });
  }
});

server.listen(PUBLIC_PORT, "127.0.0.1", () =>
  console.log(`Production build on http://127.0.0.1:${PUBLIC_PORT}`),
);

const stop = () => {
  server.close();
  app.kill("SIGTERM");
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
app.on("exit", (code) => {
  server.close();
  process.exit(code ?? 0);
});
