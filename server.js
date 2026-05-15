const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 3001);
const ROOT = __dirname;
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-4-20250514";

loadEnvFile(path.join(ROOT, ".env"));
loadEnvFile(path.join(ROOT, ".env.local"));

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    ...headers,
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter(
      (message) =>
        message &&
        (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string" &&
        message.content.trim(),
    )
    .map((message) => ({ role: message.role, content: message.content }));
}

async function handleChat(req, res) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const hasPlaceholderKey =
    !apiKey ||
    apiKey.includes("your-key") ||
    apiKey.includes("your_key") ||
    apiKey.includes("your-real-key") ||
    apiKey === "sk-ant-your-key-here";

  if (hasPlaceholderKey) {
    send(res, 500, "Setup needed: open .env.local and replace the placeholder with your real Anthropic API key, then restart `npm.cmd start`.", {
      "content-type": "text/plain; charset=utf-8",
    });
    return;
  }

  try {
    const body = await readJson(req);
    const messages = normalizeMessages(body.messages);
    const system = typeof body.system === "string" ? body.system : "";

    if (!messages.length) {
      send(res, 400, "messages array required", { "content-type": "text/plain; charset=utf-8" });
      return;
    }

    const upstream = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
        max_tokens: 1000,
        system,
        stream: true,
        messages,
      }),
    });

    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => "");
      send(res, upstream.status, text || "Anthropic request failed", {
        "content-type": "text/plain; charset=utf-8",
      });
      return;
    }

    res.writeHead(200, {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "access-control-allow-origin": "*",
    });

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() || "";

      for (const frame of frames) {
        const dataLine = frame.split("\n").find((line) => line.startsWith("data: "));
        if (!dataLine) continue;
        const payload = dataLine.slice(6).trim();
        if (payload === "[DONE]") continue;

        try {
          const json = JSON.parse(payload);
          if (json.type === "content_block_delta" && json.delta?.text) {
            res.write(json.delta.text);
          }
        } catch {
          // Ignore malformed SSE frames.
        }
      }
    }

    res.end();
  } catch (error) {
    send(res, 500, error instanceof Error ? error.message : "internal error", {
      "content-type": "text/plain; charset=utf-8",
    });
  }
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    send(res, 200, "");
    return;
  }

  const url = new URL(req.url || "/", `http://localhost:${PORT}`);

  if (url.pathname === "/api/chat" && req.method === "POST") {
    void handleChat(req, res);
    return;
  }

  const filePath = url.pathname === "/" ? path.join(ROOT, "rubberduck.html") : path.join(ROOT, url.pathname);
  if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    send(res, 404, "Not found", { "content-type": "text/plain; charset=utf-8" });
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType =
    ext === ".html"
      ? "text/html; charset=utf-8"
      : ext === ".js"
        ? "text/javascript; charset=utf-8"
        : ext === ".css"
          ? "text/css; charset=utf-8"
          : "application/octet-stream";

  send(res, 200, fs.readFileSync(filePath), { "content-type": contentType });
});

server.listen(PORT, () => {
  console.log(`Rubber Duck running at http://localhost:${PORT}`);
});
