#!/usr/bin/env node
import { spawn } from "node:child_process";

const mode = process.argv[2] === "start" ? "start" : "dev";
const apiBase = process.env.SOTAGENT_API_BASE ?? "http://127.0.0.1:4800";
const serviceName = process.env.DIGIST_WEB_SERVICE_NAME ?? "digist-web";
const project = process.env.DIGIST_WEB_PROJECT ?? "digist";
const preferredPort = Number(process.env.DIGIST_WEB_PREFERRED_PORT ?? "3810");

async function requestJson(path, body) {
  const response = await fetch(`${apiBase}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(data.message || `SOTAgent ${path} failed with HTTP ${response.status}`);
  }
  return data;
}

async function findExistingAllocation() {
  const response = await fetch(`${apiBase}/api/ports?all=true`);
  if (!response.ok) return null;
  const ports = await response.json().catch(() => []);
  return ports.find((entry) =>
    Number(entry.port) === preferredPort &&
    entry.service_name === serviceName &&
    entry.project === project
  ) ?? null;
}

async function allocatePort() {
  try {
    const data = await requestJson("/api/ports/allocate", {
      service_name: serviceName,
      project,
      preferred_port: preferredPort,
      range_start: preferredPort,
      range_end: preferredPort,
    });
    return Number(data.port);
  } catch (err) {
    const existing = await findExistingAllocation();
    if (existing) return Number(existing.port);
    throw err;
  }
}

const port = await allocatePort();
console.log(`[digist-web] SOTAgent port allocated: ${port}`);

const child = spawn("npx", ["next", mode, "--port", String(port)], {
  stdio: "inherit",
  env: { ...process.env, PORT: String(port) },
});

const heartbeat = setInterval(() => {
  requestJson("/api/ports/heartbeat", {
    port,
    pid: child.pid,
    service_name: serviceName,
    project,
  }).catch((err) => {
    console.warn(`[digist-web] SOTAgent heartbeat failed: ${err.message}`);
  });
}, 30_000);

async function shutdown(signal) {
  clearInterval(heartbeat);
  if (!child.killed) child.kill(signal);
  try {
    await requestJson("/api/ports/release", { port });
  } catch {
    // Best effort only; SOTAgent also cleans stale registrations.
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    void shutdown(signal).finally(() => process.exit(0));
  });
}

child.on("exit", (code, signal) => {
  clearInterval(heartbeat);
  void requestJson("/api/ports/release", { port }).finally(() => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 0);
  });
});
