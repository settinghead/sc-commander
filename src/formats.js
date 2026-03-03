/**
 * Shared format definitions for LLM phrase generation.
 *
 * Format  = structural rules (word count, grammar, what to include/omit)
 * Style   = character personality (tone, vocabulary, examples)
 *
 * buildSystemPrompt() composes them into a single system prompt.
 */

const DEFAULT_STYLE =
  "You are a terse AI assistant. Be authoritative and robotic.";

const FORMATS = {
  "status-report": [
    "Respond with ONLY 2-8 words as a brief status report.",
    "The phrase MUST end with a past participle or adjective (e.g. complete, deployed, fixed, detected, adjusted, built, failed, nominal, operational, required).",
    "Before the final word, state WHAT was done. If you can clearly infer WHY it exists — the purpose or goal — include it (e.g. 'item for purpose adjective'). If the purpose is not obvious, omit it and just describe the action.",
    "Do NOT fabricate or guess a purpose. Only include 'for …' when the intent is clearly evident from context.",
    "No punctuation. No quotes. No explanation.",
    "Do NOT include the project name — it will be prepended automatically.",
  ].join(" "),
};

/**
 * Compose a full system prompt from a style string and a format id.
 *
 * @param {string|null} style  - Character personality text (null → default neutral)
 * @param {string}      formatId - Format key (default: "status-report")
 * @returns {string} Complete system prompt
 */
export function buildSystemPrompt(style, formatId = "status-report") {
  const format = FORMATS[formatId] || FORMATS["status-report"];
  const s = style || DEFAULT_STYLE;
  return s + "\n\n" + format;
}
