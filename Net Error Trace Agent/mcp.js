"use strict";

const MCP_TOOLS_CACHE_KEY = "mcpToolsCache";

const MCPClient = {
  _cache: {},

  async loadServers() {
    try {
      const response = await fetch(chrome.runtime.getURL("mcp-servers.json"));
      if (!response.ok) return [];
      const data = await response.json();
      const all = Array.isArray(data.mcpServers) ? data.mcpServers : [];
      return all.filter((s) => !s.type || s.type === "http" || s.type === "sse");
    } catch {
      return [];
    }
  },

  async _rpc(serverUrl, method, params, id) {
    const response = await fetch(serverUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream"
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: id || 1, method, params: params || {} })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("text/event-stream")) {
      return this._readSseResponse(response);
    }

    const data = await response.json();
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    return data.result;
  },

  async _readSseResponse(response) {
    const text = await response.text();
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const json = trimmed.slice(5).trim();
      if (!json || json === "[DONE]") continue;
      try {
        const msg = JSON.parse(json);
        if (msg.error) throw new Error(msg.error.message || JSON.stringify(msg.error));
        if (msg.result !== undefined) return msg.result;
      } catch (parseError) {
        if (parseError.message?.startsWith("HTTP") || parseError.message?.startsWith("MCP")) throw parseError;
      }
    }
    return null;
  },

  async fetchTools(server) {
    await this._rpc(server.url, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      clientInfo: { name: "net-error-agent", version: "1.0.0" }
    }, 1).catch(() => null);

    const result = await this._rpc(server.url, "tools/list", {}, 2);
    return Array.isArray(result?.tools) ? result.tools : [];
  },

  async callTool(server, toolName, args) {
    return this._rpc(server.url, "tools/call", { name: toolName, arguments: args || {} }, Date.now());
  },

  async refreshAll() {
    const servers = await this.loadServers();
    const cache = {};

    await Promise.allSettled(
      servers.map(async (server) => {
        try {
          const tools = await this.fetchTools(server);
          cache[server.id] = { server, tools, fetchedAt: Date.now(), error: null };
        } catch (error) {
          cache[server.id] = { server, tools: [], fetchedAt: Date.now(), error: error.message };
        }
      })
    );

    this._cache = cache;
    await chrome.storage.local.set({ [MCP_TOOLS_CACHE_KEY]: cache });
    return cache;
  },

  async loadCached() {
    if (Object.keys(this._cache).length) return this._cache;
    const result = await chrome.storage.local.get(MCP_TOOLS_CACHE_KEY);
    this._cache = result[MCP_TOOLS_CACHE_KEY] || {};
    return this._cache;
  },

  async getAllTools() {
    const cache = await this.loadCached();
    const tools = [];
    for (const entry of Object.values(cache)) {
      for (const tool of entry.tools || []) {
        tools.push({ ...tool, _serverId: entry.server.id, _serverName: entry.server.name });
      }
    }
    return tools;
  },

  buildContextString(tools) {
    if (!tools || tools.length === 0) return "";
    const lines = ["Available MCP tools (use these to assist with analysis):"];
    for (const tool of tools) {
      const desc = tool.description ? ` — ${tool.description}` : "";
      lines.push(`  [${tool._serverName}] ${tool.name}${desc}`);
      if (tool.inputSchema?.properties) {
        const params = Object.entries(tool.inputSchema.properties)
          .map(([k, v]) => `${k}(${v.type || "any"})`)
          .join(", ");
        lines.push(`    params: ${params}`);
      }
    }
    return lines.join("\n");
  }
};

globalThis.MCPClient = MCPClient;
