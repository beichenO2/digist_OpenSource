import { MCPClient, MCPServerConfig, createMCPClient } from './mcp-client.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

export interface MCPRegistryEntry {
  name: string;
  url: string;
  headers?: Record<string, string>;
  enabled: boolean;
  description?: string;
  addedAt: string;
}

const REGISTRY_DIR = process.env.DIGIST_DATA_DIR ?? './data';
const REGISTRY_FILE = join(REGISTRY_DIR, 'mcp-registry.json');

function loadRegistry(): MCPRegistryEntry[] {
  if (!existsSync(REGISTRY_FILE)) return [];
  try {
    return JSON.parse(readFileSync(REGISTRY_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function saveRegistry(entries: MCPRegistryEntry[]): void {
  mkdirSync(REGISTRY_DIR, { recursive: true });
  writeFileSync(REGISTRY_FILE, JSON.stringify(entries, null, 2));
}

export function listMCPServers(): MCPRegistryEntry[] {
  return loadRegistry();
}

export function registerMCPServer(config: Omit<MCPRegistryEntry, 'addedAt'>): MCPRegistryEntry {
  const entries = loadRegistry();
  const existing = entries.findIndex((e) => e.name === config.name);
  const entry: MCPRegistryEntry = {
    ...config,
    addedAt: new Date().toISOString(),
  };

  if (existing >= 0) {
    entries[existing] = entry;
  } else {
    entries.push(entry);
  }

  saveRegistry(entries);
  return entry;
}

export function removeMCPServer(name: string): boolean {
  const entries = loadRegistry();
  const idx = entries.findIndex((e) => e.name === name);
  if (idx < 0) return false;
  entries.splice(idx, 1);
  saveRegistry(entries);
  return true;
}

export function getEnabledClients(): { name: string; client: MCPClient }[] {
  return loadRegistry()
    .filter((e) => e.enabled)
    .map((e) => ({
      name: e.name,
      client: createMCPClient({
        name: e.name,
        url: e.url,
        headers: e.headers,
      }),
    }));
}

export async function discoverAllTools(): Promise<{ server: string; tools: { name: string; description: string }[] }[]> {
  const clients = getEnabledClients();
  const results: { server: string; tools: { name: string; description: string }[] }[] = [];

  for (const { name, client } of clients) {
    const ok = await client.initialize();
    if (!ok) {
      console.warn(`[MCPRegistry] Failed to initialize ${name}`);
      continue;
    }
    const tools = await client.listTools();
    results.push({ server: name, tools });
  }

  return results;
}
