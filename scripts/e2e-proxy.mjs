import http from "node:http";

const dashboardOrigin = new URL(process.env.MARKETPLACE_ADMIN_PREVIEW_ORIGIN || "http://127.0.0.1:4173");
const apiOriginRaw = process.env.MARKETPLACE_E2E_API_ORIGIN;
if (!apiOriginRaw) throw new Error("MARKETPLACE_E2E_API_ORIGIN is required; use a dedicated non-production test environment.");
const apiOrigin = new URL(apiOriginRaw);
const port = Number(process.env.MARKETPLACE_ADMIN_PROXY_PORT || 4180);
const hopByHop = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailers", "transfer-encoding", "upgrade", "host", "content-length", "accept-encoding"]);

const server = http.createServer(async (req, res) => {
  if (req.url === "/__health") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }

  const isApi = req.url?.startsWith("/api/") || req.url?.startsWith("/oauth2/") || req.url?.startsWith("/login");
  const base = isApi ? apiOrigin : dashboardOrigin;
  const target = new URL(req.url || "/", base);
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value && !hopByHop.has(name.toLowerCase())) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }

  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks);
    const methodHasBody = !["GET", "HEAD"].includes(req.method || "GET");
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      ...(methodHasBody ? { body } : {}),
      redirect: "manual",
    });
    const outHeaders = {};
    upstream.headers.forEach((value, name) => {
      if (!["content-encoding", "content-length", "transfer-encoding", "connection"].includes(name.toLowerCase())) {
        outHeaders[name] = value;
      }
    });
    res.writeHead(upstream.status, outHeaders);
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    console.error(`Proxy failure for ${req.method} ${req.url}: ${error instanceof Error ? error.message : "unknown error"}`);
    if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
    res.end("Local E2E proxy could not reach its upstream.");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Marketplace E2E proxy listening on http://127.0.0.1:${port}`);
});
