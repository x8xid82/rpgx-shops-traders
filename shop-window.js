import { MODULE_ID } from "./currency.js";

/**
 * Cached RPGX Proton connection status. Refreshed by refreshProtonStatus(),
 * read synchronously everywhere else so opening a window never blocks on
 * a network call.
 */
export const protonStatus = {
  detected: false
};

/** Resolve the configured Ollama model name (the setting stores the literal model name, e.g. "phi4"). */
export function getConfiguredModel() {
  return game.settings.get(MODULE_ID, "ollamaModel") || "phi4";
}

/**
 * Auth token for RPGX Proton.
 * Reads rpgx-ai's token first, both modules talk to the same Proton instance,
 * so there is only ever one token to configure. Falls back to this module's
 * own protonToken setting if rpgx-ai is not installed.
 */
export function getProtonToken() {
  try {
    const shared = game.settings.get("rpgx-ai", "protonToken");
    if (shared) return shared;
  } catch {
    /* rpgx-ai not installed, fall through */
  }
  return game.settings.get(MODULE_ID, "protonToken") || "";
}

function getRagBase() {
  return (game.settings.get(MODULE_ID, "ragBase") || "http://127.0.0.1:3033").replace(/\/+$/, "");
}

function getTimeoutMs() {
  return (game.settings.get(MODULE_ID, "aiTimeout") || 60) * 1000;
}

function getTemperature() {
  return game.settings.get(MODULE_ID, "aiTemperature") ?? 0.8;
}

/**
 * Check whether RPGX Proton is reachable at all and update the cached
 * protonStatus. Safe to call often, it's a single fast /ping request.
 */
export async function refreshProtonStatus() {
  try {
    const res = await fetch(`${getRagBase()}/ping`, {
      signal: AbortSignal.timeout(5000),
      headers: { Authorization: `Bearer ${getProtonToken()}` }
    });
    protonStatus.detected = res.ok;
  } catch {
    protonStatus.detected = false;
  }
  return protonStatus.detected;
}

/**
 * Ask RPGX Proton's local Ollama instance to generate content and return
 * the parsed JSON object. Mirrors RPGX Quest Log's generation pipeline:
 * POST /ollama/generate, read the NDJSON response, then extract the last
 * balanced JSON object that has all of requiredKeys.
 */
export async function generateJSON(prompt, requiredKeys = []) {
  const url = `${getRagBase()}/ollama/generate`;
  const timeoutMs = getTimeoutMs();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getProtonToken()}`
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: getConfiguredModel(),
        prompt,
        stream: false,
        options: { temperature: getTemperature(), top_p: 0.95 }
      })
    });
  } catch (e) {
    clearTimeout(timeoutId);
    if (e.name === "AbortError") {
      throw new Error(
        `AI generation timed out after ${timeoutMs / 1000} seconds. Try a smaller model tier, or increase the timeout in RPGX Shops & Traders settings.`
      );
    }
    throw new Error(
      `Cannot reach RPGX Proton at ${url}. Make sure Proton is running on your computer. Download RPGX Proton free at rpgxstudios.com. (${e.message})`
    );
  }
  clearTimeout(timeoutId);

  if (!response.ok) {
    throw new Error(`RPGX Proton returned ${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  const content = readNDJSON(text);
  return parseAIJSON(content, requiredKeys);
}

/** Concatenate an Ollama-style NDJSON response into one string. */
function readNDJSON(text) {
  if (!text?.trim()) throw new Error("Empty response from AI.");

  const lines = text.trim().split("\n");
  let content = "";

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed.response) content += parsed.response;
      else if (parsed.message?.content) content += parsed.message.content;
    } catch {
      console.warn("RPGX Shops & Traders | Could not parse NDJSON line:", line);
    }
  }

  if (!content.trim()) {
    throw new Error("AI returned no content. The model may have timed out, try again.");
  }

  return content.trim();
}

/**
 * Extract and parse a JSON object from raw model output.
 *
 * Some models emit chain-of-thought text before, after, or even inside the
 * JSON they generate. This walks the text for every balanced top-level
 * {...} object (a brace-depth walker that ignores braces inside strings),
 * then tries each candidate from LAST to FIRST, returning the first one
 * that has all of requiredKeys. The model's clean final attempt is almost
 * always the last complete object in the output.
 */
function parseAIJSON(text, requiredKeys = []) {
  if (!text?.trim()) throw new Error("Empty response from AI.");

  const raw = text.replace(/^```(?:json)?\s*/m, "").replace(/\s*```$/m, "").trim();

  const normalise = s => s
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...");

  const escapeControls = s => s.replace(
    /"(?:[^"\\]|\\.)*"/gs,
    m => m.replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t")
  );

  const extractCandidates = src => {
    const candidates = [];
    for (let i = 0; i < src.length; i++) {
      if (src[i] !== "{") continue;
      let depth = 0, inStr = false, escaped = false;
      for (let j = i; j < src.length; j++) {
        const ch = src[j];
        if (escaped) { escaped = false; continue; }
        if (ch === "\\" && inStr) { escaped = true; continue; }
        if (ch === '"') { inStr = !inStr; continue; }
        if (!inStr && ch === "{") { depth++; continue; }
        if (!inStr && ch === "}") {
          depth--;
          if (depth === 0) { candidates.push(src.slice(i, j + 1)); break; }
        }
      }
    }
    return candidates;
  };

  const candidates = extractCandidates(normalise(raw));
  const errors = [];

  for (const candidate of [...candidates].reverse()) {
    try {
      const parsed = JSON.parse(escapeControls(candidate));
      if (requiredKeys.every(key => parsed[key])) return parsed;
    } catch (e) {
      errors.push(e.message);
    }
  }

  console.error("RPGX Shops & Traders | Could not parse AI response. Raw output:", text);
  throw new Error(
    `Could not parse the AI response after trying ${candidates.length || 0} JSON candidate(s). Try a different model or simplify your prompt.`
  );
}

/** Build the prompt used to generate a business's name, type, description, and GM notes. */
export function buildBusinessPrompt({ userPrompt, businessType, location, existingNames = [] }) {
  const gameSystem = game.settings.get(MODULE_ID, "gameSystem");
  const genre = game.settings.get(MODULE_ID, "genre");

  const context = [];
  if (gameSystem) context.push(`Game system: ${gameSystem}.`);
  if (genre) context.push(`Campaign genre/tone: ${genre}.`);
  if (businessType) context.push(`The business type is: ${businessType}.`);
  if (location) context.push(`It is located in: ${location}.`);

  if (existingNames.length) {
    context.push(
      `Other shops that already exist in this world: ${existingNames.join(", ")}. ` +
      `The new shop's name must be different from all of these, and should not just be a minor variation of one of them.`
    );
  }

  const instructions = userPrompt
    ? `Create a shop with this theme or premise: ${userPrompt}`
    : `Create an original shop fitting the setting${genre ? ` ("${genre}")` : ""}${gameSystem ? ` using ${gameSystem}` : ""}.`;

  const system = [
    "You are helping a tabletop RPG Game Master create a shop for their players.",
    context.join(" ")
  ].filter(Boolean).join(" ");

  return `${system}\n\nUSER: ${instructions}\nRespond with ONLY a JSON object, no other text and no markdown formatting, using exactly these keys:\n{"name": "Shop name", "businessType": "Short category, e.g. General Store, Blacksmith, Tavern", "description": "2-4 sentences describing the shop, written to be read aloud to players", "otherNotes": "1-2 sentences of GM-only notes or secrets"}\nASSISTANT:`;
}
