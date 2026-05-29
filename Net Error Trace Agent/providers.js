"use strict";

const PROVIDERS = {
  openai: {
    label: "OpenAI",
    fields: [
      { key: "apiKey", label: "API Key", type: "password", placeholder: "sk-..." },
      {
        key: "model",
        label: "Model",
        type: "select",
        options: [
          { value: "gpt-4o", label: "GPT-4o" },
          { value: "gpt-4o-mini", label: "GPT-4o mini" },
          { value: "gpt-4.1-mini", label: "GPT-4.1 mini" }
        ]
      }
    ]
  },
  claude: {
    label: "Claude",
    fields: [
      { key: "apiKey", label: "API Key", type: "password", placeholder: "sk-ant-..." },
      {
        key: "model",
        label: "Model",
        type: "select",
        options: [
          { value: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
          { value: "claude-3-7-sonnet-latest", label: "Claude 3.7 Sonnet" }
        ]
      }
    ]
  },
  azure_openai: {
    label: "Azure OpenAI",
    fields: [
      { key: "apiKey", label: "API Key", type: "password", placeholder: "Azure API Key" },
      { key: "endpoint", label: "Endpoint", type: "text", placeholder: "https://your-resource.openai.azure.com" },
      { key: "deployment", label: "Deploy", type: "text", placeholder: "gpt-4o" },
      { key: "apiVersion", label: "Version", type: "text", placeholder: "2024-02-01" }
    ]
  },
  ollama: {
    label: "Ollama",
    fields: [
      { key: "endpoint", label: "Endpoint", type: "text", placeholder: "http://localhost:11434" },
      { key: "model", label: "Model", type: "text", placeholder: "llama3" }
    ]
  },
  github_copilot: {
    label: "GitHub Copilot",
    hasOAuthFlow: true,
    fields: [
      {
        key: "model",
        label: "Model",
        type: "select",
        options: [
          { value: "gpt-4o", label: "GPT-4o" },
          { value: "gpt-4o-mini", label: "GPT-4o mini" },
          { value: "o3-mini", label: "o3-mini" }
        ]
      }
    ]
  }
};

const GH_COPILOT_HEADERS = {
  "Editor-Version": "vscode/1.95.3",
  "Editor-Plugin-Version": "copilot-chat/0.22.4",
  "Copilot-Integration-Id": "vscode-chat",
  "User-Agent": "GitHubCopilotChat/0.22.4"
};

const GH_DEVICE_CLIENT_ID = "178c6fc778ccc68e1d6a";

function extractJson(text) {
  const cleaned = String(text || "").replaceAll(/```json\n?|\n?```/g, "").trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const match = /\{[\s\S]*\}/.exec(cleaned);
    if (!match) {
      throw new Error(`JSON parse failed: ${cleaned.slice(0, 160)}`);
    }

    try {
      return JSON.parse(match[0]);
    } catch {
      throw new Error(`JSON parse failed: ${cleaned.slice(0, 160)}`);
    }
  }
}

function normalizeUsage(rawUsage) {
  return {
    input: Number(rawUsage?.input || rawUsage?.prompt_tokens || rawUsage?.input_tokens || 0),
    output: Number(rawUsage?.output || rawUsage?.completion_tokens || rawUsage?.output_tokens || 0)
  };
}

const SYSTEM_JSON = "You are a network error analysis assistant. Always return valid JSON only.";
const SYSTEM_CHAT = "You are a helpful assistant for web developers and QA engineers. Answer in Korean. Be concise and practical.";

async function callOpenAI(config, prompt, systemPrompt) {
  if (!config.apiKey) throw new Error("OpenAI API key is missing");
  const isJson = !systemPrompt || systemPrompt === SYSTEM_JSON;
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model: config.model || "gpt-4o",
      temperature: 0.2,
      ...(isJson ? { response_format: { type: "json_object" } } : {}),
      messages: [
        { role: "system", content: systemPrompt || SYSTEM_JSON },
        { role: "user", content: prompt }
      ]
    })
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`OpenAI ${response.status}: ${err.error?.message || response.statusText}`);
  }
  const data = await response.json();
  return { text: data.choices?.[0]?.message?.content || "", usage: normalizeUsage(data.usage) };
}

async function callClaude(config, prompt, systemPrompt) {
  if (!config.apiKey) throw new Error("Claude API key is missing");
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({
      model: config.model || "claude-sonnet-4-5",
      messages: [{ role: "user", content: prompt }],
      system: systemPrompt || SYSTEM_JSON
    })
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`Claude ${response.status}: ${err.error?.message || response.statusText}`);
  }
  const data = await response.json();
  return { text: data.content?.[0]?.text || "", usage: normalizeUsage(data.usage) };
}

async function callAzureOpenAI(config, prompt, systemPrompt) {
  const endpoint = String(config.endpoint || "").replace(/\/$/, "");
  const deployment = String(config.deployment || "");
  const apiVersion = String(config.apiVersion || "2024-02-01");
  if (!endpoint || !deployment || !config.apiKey) {
    throw new Error("Azure OpenAI requires endpoint, deployment and API key");
  }
  const isJson = !systemPrompt || systemPrompt === SYSTEM_JSON;
  const response = await fetch(`${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": config.apiKey },
    body: JSON.stringify({
      temperature: 0.2,
      ...(isJson ? { response_format: { type: "json_object" } } : {}),
      messages: [
        { role: "system", content: systemPrompt || SYSTEM_JSON },
        { role: "user", content: prompt }
      ]
    })
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`Azure OpenAI ${response.status}: ${err.error?.message || response.statusText}`);
  }

  const data = await response.json();
  return {
    text: data.choices?.[0]?.message?.content || "",
    usage: normalizeUsage(data.usage)
  };
}

async function callOllama(config, prompt, systemPrompt) {
  const endpoint = String(config.endpoint || "http://localhost:11434").replace(/\/$/, "");
  const isJson = !systemPrompt || systemPrompt === SYSTEM_JSON;
  const response = await fetch(`${endpoint}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.model || "llama3",
      stream: false,
      ...(isJson ? { format: "json" } : {}),
      messages: [
        { role: "system", content: systemPrompt || SYSTEM_JSON },
        { role: "user", content: prompt }
      ]
    })
  });
  if (!response.ok) throw new Error(`Ollama ${response.status}: connection failed (${endpoint})`);
  const data = await response.json();
  return {
    text: data.message?.content || "",
    usage: { input: Number(data.prompt_eval_count || 0), output: Number(data.eval_count || 0) }
  };
}

const GithubCopilotAPI = {
  async startDeviceFlow() {
    const response = await fetch("https://github.com/login/device/code", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        client_id: GH_DEVICE_CLIENT_ID,
        scope: "copilot"
      })
    });

    if (!response.ok) {
      throw new Error(`Device flow start failed: ${response.status}`);
    }

    return response.json();
  },

  async checkDeviceToken(deviceCode) {
    const response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        client_id: GH_DEVICE_CLIENT_ID,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code"
      })
    });

    return response.json();
  },

  async getUsername(accessToken) {
    const response = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `token ${accessToken}`,
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return data.login || null;
  },

  async getCopilotSessionToken(accessToken) {
    const commonHeaders = {
      Accept: "application/json",
      "User-Agent": "GitHubCopilotChat/0.22.4",
      "X-GitHub-Api-Version": "2022-11-28"
    };

    for (const authValue of [`token ${accessToken}`, `Bearer ${accessToken}`]) {
      const response = await fetch("https://api.github.com/copilot_internal/v2/token", {
        headers: {
          ...commonHeaders,
          Authorization: authValue
        }
      });

      if (response.ok) {
        const data = await response.json();
        return {
          token: data.token,
          expiresAt: new Date(data.expires_at).getTime()
        };
      }

      if (response.status !== 404 && response.status !== 401) {
        const err = await response.json().catch(() => ({}));
        throw new Error(`Copilot token ${response.status}: ${err.message || response.statusText}`);
      }
    }

    return null;
  },

  async fetchModels(sessionToken, accessToken) {
    const isChatModel = (item) => {
      if (!item?.id && !item?.name) {
        return false;
      }

      if (item.model_picker_enabled === false) {
        return false;
      }

      if (item.policy?.state === "disabled") {
        return false;
      }

      const type = String(item.task || item.type || item.capabilities?.type || "").toLowerCase();
      return !type.includes("embed");
    };

    const toOption = (item) => ({
      value: item.id || item.name,
      label: item.display_name || item.friendly_name || item.name || item.id
    });

    const dedup = (list) => {
      const seen = new Set();
      return list.filter((item) => {
        const key = String(item.label || "").toLowerCase().trim();
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
    };

    const tryFetch = async (url, headers) => {
      const response = await fetch(url, { headers });
      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      const raw = Array.isArray(data) ? data : (data.data || data.models || []);
      const options = dedup(raw.filter(isChatModel).map(toOption));
      return options.sort((a, b) => a.label.localeCompare(b.label));
    };

    if (sessionToken) {
      const options = await tryFetch("https://api.githubcopilot.com/models", {
        ...GH_COPILOT_HEADERS,
        Authorization: `Bearer ${sessionToken}`,
        "Content-Type": "application/json"
      });
      if (options?.length) {
        return options;
      }
    }

    if (accessToken) {
      const options = await tryFetch("https://api.githubcopilot.com/models", {
        ...GH_COPILOT_HEADERS,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      });
      if (options?.length) {
        return options;
      }
    }

    if (accessToken) {
      const options = await tryFetch("https://models.inference.ai.azure.com/models", {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json"
      });
      if (options?.length) {
        return options;
      }
    }

    return [
      { value: "gpt-4o", label: "GPT-4o" },
      { value: "gpt-4o-mini", label: "GPT-4o mini" },
      { value: "o3-mini", label: "o3-mini" }
    ];
  },

  async ensureSessionToken(auth) {
    if (auth.sessionToken && Date.now() < Number(auth.sessionExpiry || 0) - 120000) {
      return auth.sessionToken;
    }

    const result = await this.getCopilotSessionToken(auth.accessToken);
    if (!result) {
      return null;
    }

    auth.sessionToken = result.token;
    auth.sessionExpiry = result.expiresAt;
    await chrome.storage.local.set({ githubCopilotAuth: auth });
    return result.token;
  }
};

async function callGitHubCopilot(config, prompt, systemPrompt) {
  const { githubCopilotAuth: auth } = await chrome.storage.local.get("githubCopilotAuth");
  if (!auth?.accessToken) throw new Error("GitHub Copilot login required in settings");
  const sessionToken = await GithubCopilotAPI.ensureSessionToken(auth);
  const isJson = !systemPrompt || systemPrompt === SYSTEM_JSON;
  const requestBody = JSON.stringify({
    model: config.model || "gpt-4o",
    messages: [
      { role: "system", content: systemPrompt || SYSTEM_JSON },
      { role: "user", content: prompt }
    ],
    temperature: 0.2,
    ...(isJson ? { response_format: { type: "json_object" } } : {})
  });

  const mapOpenAIResponse = (data) => ({
    text: data.choices?.[0]?.message?.content || "",
    usage: normalizeUsage(data.usage)
  });

  if (sessionToken) {
    const response = await fetch("https://api.githubcopilot.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionToken}`,
        ...GH_COPILOT_HEADERS
      },
      body: requestBody
    });

    if (response.ok) {
      return mapOpenAIResponse(await response.json());
    }

    const err = await response.json().catch(() => ({}));
    throw new Error(`GitHub Copilot ${response.status}: ${err.error?.message || response.statusText}`);
  }

  {
    const response = await fetch("https://api.githubcopilot.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.accessToken}`,
        ...GH_COPILOT_HEADERS
      },
      body: requestBody
    });

    if (response.ok) {
      return mapOpenAIResponse(await response.json());
    }

    if (response.status !== 401 && response.status !== 403) {
      const err = await response.json().catch(() => ({}));
      throw new Error(`GitHub Copilot ${response.status}: ${err.error?.message || response.statusText}`);
    }
  }

  const fallback = await fetch("https://models.inference.ai.azure.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${auth.accessToken}`
    },
    body: requestBody
  });

  if (!fallback.ok) {
    const err = await fallback.json().catch(() => ({}));
    throw new Error(`GitHub Models ${fallback.status}: ${err.error?.message || fallback.statusText}`);
  }

  return mapOpenAIResponse(await fallback.json());
}

async function callProviderRaw(provider, config, prompt, systemPrompt) {
  switch (provider) {
    case "openai": return callOpenAI(config, prompt, systemPrompt);
    case "claude": return callClaude(config, prompt, systemPrompt);
    case "azure_openai": return callAzureOpenAI(config, prompt, systemPrompt);
    case "ollama": return callOllama(config, prompt, systemPrompt);
    case "github_copilot": return callGitHubCopilot(config, prompt, systemPrompt);
    default: throw new Error(`Unknown provider: ${provider}`);
  }
}

async function callAI(provider, config, prompt) {
  const raw = await callProviderRaw(provider, config, prompt, SYSTEM_JSON);
  return { result: extractJson(raw.text), usage: raw.usage };
}

async function callAIText(provider, config, prompt, systemPrompt) {
  const raw = await callProviderRaw(provider, config, prompt, systemPrompt || SYSTEM_CHAT);
  return { text: String(raw.text || "").trim(), usage: raw.usage };
}

globalThis.AIProviders = {
  PROVIDERS,
  callAI,
  callAIText,
  GithubCopilotAPI
};
