import axios from 'axios';

export interface MCPToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface MCPToolResult {
  content: { type: string; text?: string; data?: unknown }[];
  isError?: boolean;
}

export interface MCPServerConfig {
  name: string;
  url: string;
  headers?: Record<string, string>;
}

export class MCPClient {
  private config: MCPServerConfig;
  private sessionId: string | null = null;
  private connected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private static readonly MAX_RECONNECT_DELAY = 60_000;
  private static readonly BASE_RECONNECT_DELAY = 2_000;

  constructor(config: MCPServerConfig) {
    this.config = config;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  async initialize(): Promise<boolean> {
    try {
      const resp = await axios.post(
        this.config.url,
        {
          jsonrpc: '2.0',
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'digist-mcp-client', version: '0.1.0' },
          },
          id: 0,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            ...this.config.headers,
          },
          timeout: 10000,
        }
      );

      if (resp.data?.result) {
        console.log(`[MCP] Connected to ${this.config.name}`);
        this.connected = true;
        this.reconnectAttempts = 0;
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
        return true;
      }
      this.connected = false;
      this.scheduleReconnect();
      return false;
    } catch (err) {
      console.error(`[MCP] Failed to connect to ${this.config.name}:`, err instanceof Error ? err.message : err);
      this.connected = false;
      this.scheduleReconnect();
      return false;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectAttempts++;
    const delay = Math.min(
      MCPClient.BASE_RECONNECT_DELAY * Math.pow(2, this.reconnectAttempts - 1),
      MCPClient.MAX_RECONNECT_DELAY,
    );
    console.log(`[MCP] ${this.config.name} reconnect scheduled in ${delay}ms (attempt ${this.reconnectAttempts})`);
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      await this.initialize();
    }, delay);
  }

  dispose(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  async listTools(): Promise<{ name: string; description: string }[]> {
    try {
      const resp = await axios.post(
        this.config.url,
        {
          jsonrpc: '2.0',
          method: 'tools/list',
          params: {},
          id: 1,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            ...this.config.headers,
          },
          timeout: 10000,
        }
      );

      return resp.data?.result?.tools ?? [];
    } catch (err) {
      console.error(`[MCP] listTools failed:`, err instanceof Error ? err.message : err);
      return [];
    }
  }

  async callTool(call: MCPToolCall): Promise<MCPToolResult> {
    if (!this.connected) {
      return {
        content: [{ type: 'text', text: `[MCP] ${this.config.name} not connected (reconnecting in background)` }],
        isError: true,
      };
    }
    try {
      const resp = await axios.post(
        this.config.url,
        {
          jsonrpc: '2.0',
          method: 'tools/call',
          params: {
            name: call.name,
            arguments: call.arguments,
          },
          id: Date.now(),
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            ...this.config.headers,
          },
          timeout: 30000,
        }
      );

      return resp.data?.result ?? { content: [], isError: true };
    } catch (err) {
      this.connected = false;
      this.scheduleReconnect();
      return {
        content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  }
}

export function createMCPClient(config: MCPServerConfig): MCPClient {
  return new MCPClient(config);
}
