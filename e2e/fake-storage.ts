import http from "node:http";

/**
 * Supabase Storage FALSO para os testes de tela: só 127.0.0.1, bytes em memória, nada de rede externa.
 * Implementa o mínimo que o site usa (envio, remoção e leitura pública do bucket `service-images`) e exige a chave
 * de serviço de teste nas escritas, como o de verdade. Dois controles de teste (`/__e2e/*`) simulam o Storage fora do ar.
 */
export const FAKE_STORAGE_PORT = 54340;
export const FAKE_SERVICE_KEY = "e2e-service-role-key-not-real";

export function startFakeStorage(port = FAKE_STORAGE_PORT): Promise<http.Server> {
  const objects = new Map<string, { bytes: Buffer; type: string }>();
  let offline = false;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const send = (status: number, body = "", type = "application/json") => {
      res.writeHead(status, { "content-type": type });
      res.end(body);
    };

    if (url.pathname === "/__e2e/offline") {
      offline = url.searchParams.get("on") === "1";
      return send(200, JSON.stringify({ offline }));
    }
    if (url.pathname === "/__e2e/count") return send(200, JSON.stringify({ count: objects.size }));

    const publicPrefix = "/storage/v1/object/public/service-images/";
    const writePrefix = "/storage/v1/object/service-images/";

    if (req.method === "GET" && url.pathname.startsWith(publicPrefix)) {
      if (offline) return send(503, "offline");
      const obj = objects.get(decodeURIComponent(url.pathname.slice(publicPrefix.length)));
      if (!obj) return send(404, "not found");
      res.writeHead(200, { "content-type": obj.type, "cache-control": "public, max-age=31536000" });
      return res.end(obj.bytes);
    }

    if (url.pathname.startsWith(writePrefix) && (req.method === "POST" || req.method === "DELETE")) {
      if (req.headers.authorization !== `Bearer ${FAKE_SERVICE_KEY}`) return send(401, JSON.stringify({ error: "unauthorized" }));
      if (offline) return send(503, JSON.stringify({ error: "offline" }));
      const key = decodeURIComponent(url.pathname.slice(writePrefix.length));
      if (req.method === "DELETE") {
        objects.delete(key);
        return send(200, JSON.stringify({ message: "Successfully deleted" }));
      }
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        if (objects.has(key)) return send(409, JSON.stringify({ error: "Duplicate" }));
        objects.set(key, { bytes: Buffer.concat(chunks), type: String(req.headers["content-type"] ?? "application/octet-stream") });
        send(200, JSON.stringify({ Key: `service-images/${key}` }));
      });
      return;
    }

    if (url.pathname.startsWith("/storage/v1/bucket")) return send(200, JSON.stringify({ name: "service-images" }));
    send(404, "not found");
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}
