import { writeFileSync, appendFileSync, mkdirSync } from "fs";
import { join } from "path";
import { request as httpsRequest } from "https";
import { COLLECT_DIR, STATE_DIR, USAGE_FILE } from "./paths.js";
import { buildSystemPrompt } from "./formats.js";

function saveLlmPair(messages, responseText, model, config) {
  if (!config.collect_llm_data) return;
  try {
    mkdirSync(COLLECT_DIR, { recursive: true });
    const record = {
      timestamp: Date.now() / 1000,
      model,
      messages,
      response: responseText,
    };
    const filename = `${Date.now()}.json`;
    writeFileSync(
      join(COLLECT_DIR, filename),
      JSON.stringify(record, null, 2),
    );
  } catch {
    // ignore
  }
}

function logUsage(model, usage) {
  if (!usage) return;
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    const record = JSON.stringify({
      timestamp: new Date().toISOString(),
      model,
      prompt_tokens: usage.prompt_tokens || 0,
      completion_tokens: usage.completion_tokens || 0,
      total_tokens: usage.total_tokens || 0,
      cost: usage.cost != null ? usage.cost : undefined,
    });
    appendFileSync(USAGE_FILE, record + "\n");
  } catch {
    // best-effort
  }
}

export function extractContext(eventData) {
  const event = eventData.hook_event_name || "";

  if (event === "Stop") {
    const msg = eventData.last_assistant_message || "";
    if (msg) {
      return `Coding task completed. Assistant's summary: ${msg.slice(0, 300)}`;
    }
    return null;
  }

  return null;
}

export function generatePhraseLlm(context, config, style) {
  return new Promise((resolve) => {
    const apiKey = config.openrouter_api_key || "";
    if (!apiKey) return resolve({ phrase: null, fallbackReason: "no_api_key" });

    const model = config.openrouter_model || "qwen/qwen3.5-flash-02-23";

    const messages = [
      { role: "system", content: buildSystemPrompt(style) },
      { role: "user", content: context },
    ];

    const payload = JSON.stringify({
      model,
      messages,
      max_tokens: 30,
      temperature: 0.9,
    });

    const req = httpsRequest(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
        timeout: 5000,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const result = JSON.parse(data);
            const usage = result.usage || null;
            logUsage(model, usage);
            let phrase = result.choices[0].message.content.trim();
            saveLlmPair(messages, phrase, model, config);
            // Clean up: remove quotes, punctuation, limit to 8 words
            phrase = phrase.replace(/^["'.,!;:]+|["'.,!;:]+$/g, "").trim();
            const words = phrase.split(/\s+/).slice(0, 8);
            if (words.length) {
              resolve({ phrase: words.join(" "), fallbackReason: null, usage });
            } else {
              resolve({ phrase: null, fallbackReason: "empty_response", detail: result, usage });
            }
          } catch (err) {
            resolve({ phrase: null, fallbackReason: "parse_error", detail: `${err.message}; body=${data.slice(0, 200)}` });
          }
        });
      },
    );

    req.on("error", (err) => resolve({ phrase: null, fallbackReason: "request_error", detail: err.message }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ phrase: null, fallbackReason: "timeout" });
    });
    req.write(payload);
    req.end();
  });
}
