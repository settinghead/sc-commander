// LLM provider registry — base URLs, auth patterns, default models, signup URLs.
// Anthropic uses its own Messages API format; all others are OpenAI-compatible.

export const LLM_PROVIDERS = {
  openrouter: {
    name: "OpenRouter",
    description: "200+ models, cheap",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "google/gemma-3-27b-it",
    signupUrl: "https://openrouter.ai/keys",
    authHeader: (key) => ({ Authorization: `Bearer ${key}` }),
    format: "openai",
  },
  openai: {
    name: "OpenAI",
    description: "GPT-4o-mini",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    signupUrl: "https://platform.openai.com/api-keys",
    authHeader: (key) => ({ Authorization: `Bearer ${key}` }),
    format: "openai",
  },
  gemini: {
    name: "Google Gemini",
    description: "free tier available",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-2.0-flash",
    signupUrl: "https://aistudio.google.com/apikey",
    authHeader: (key) => ({ Authorization: `Bearer ${key}` }),
    format: "openai",
  },
  anthropic: {
    name: "Anthropic",
    description: "Claude 3.5 Haiku",
    baseUrl: "https://api.anthropic.com",
    defaultModel: "claude-3-5-haiku-latest",
    signupUrl: "https://console.anthropic.com/settings/keys",
    authHeader: (key) => ({
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    }),
    format: "anthropic",
  },
};

export function getProvider(id) {
  return LLM_PROVIDERS[id] || null;
}

/**
 * Resolve the API key for a given provider from config.
 * Checks unified llm_api_key first, then legacy openrouter_api_key for backward compat.
 */
export function getApiKey(config) {
  if (config.llm_api_key) return config.llm_api_key;
  // Backward compat: openrouter_api_key
  if (config.openrouter_api_key) return config.openrouter_api_key;
  return "";
}

/**
 * Resolve the model for a given provider from config.
 */
export function getModel(config) {
  const provider = getProvider(config.llm_backend);
  if (config.llm_model) return config.llm_model;
  // Backward compat: openrouter_model
  if (config.llm_backend === "openrouter" && config.openrouter_model) {
    return config.openrouter_model;
  }
  return provider ? provider.defaultModel : "gpt-4o-mini";
}

/**
 * Build the request body for the given provider format.
 */
export function formatRequestBody(provider, model, messages, maxTokens, temperature) {
  if (provider.format === "anthropic") {
    // Convert OpenAI-style messages to Anthropic Messages API format
    const system = messages.find((m) => m.role === "system")?.content || "";
    const userMessages = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role, content: m.content }));
    return JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      system,
      messages: userMessages,
    });
  }
  // OpenAI-compatible format (openrouter, openai, gemini)
  return JSON.stringify({
    model,
    messages,
    max_tokens: maxTokens,
    temperature,
  });
}

/**
 * Parse the response body from a provider into { phrase, usage }.
 */
export function parseResponse(provider, data) {
  if (provider.format === "anthropic") {
    const text = data.content?.[0]?.text || "";
    const usage = data.usage
      ? {
          prompt_tokens: data.usage.input_tokens || 0,
          completion_tokens: data.usage.output_tokens || 0,
          total_tokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0),
        }
      : null;
    return { text, usage };
  }
  // OpenAI-compatible
  const text = data.choices?.[0]?.message?.content || "";
  const usage = data.usage || null;
  return { text, usage };
}

/**
 * Get the full chat completions endpoint URL for a provider.
 */
export function getEndpointUrl(provider) {
  const base = provider.baseUrl.replace(/\/+$/, "");
  if (provider.format === "anthropic") return `${base}/v1/messages`;
  return `${base}/chat/completions`;
}
