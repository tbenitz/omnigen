export const SETTINGS_KEY = "omnigen.settings.v1";

export function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
  } catch {
    return {};
  }
}

export function saveSettings(next) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
}

function getKey(settings, name) {
  return (settings.keys?.[name] || "").trim();
}

async function readError(res) {
  const text = await res.text().catch(() => "");
  let extra = text.slice(0, 400);
  try {
    const j = JSON.parse(text);
    extra = j.error?.message || j.message || j.error || extra;
  } catch {}
  return `${res.status} ${res.statusText}${extra ? " — " + extra : ""}`;
}

async function chatCompletions(url, key, body) {
  const headers = { "Content-Type": "application/json" };
  if (key) headers.Authorization = `Bearer ${key}`;
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || data.choices?.[0]?.text || JSON.stringify(data);
  return { text, raw: data };
}

function lastUser(messages, prompt) {
  if (prompt) return prompt;
  const last = [...messages].reverse().find((m) => m.role === "user");
  return last?.text || "";
}

function toOpenAIMessages(messages, prompt, system) {
  const out = [];
  if (system) out.push({ role: "system", content: system });
  for (const m of messages || []) {
    if (!m.text) continue;
    out.push({ role: m.role === "assistant" ? "assistant" : "user", content: m.text });
  }
  if (prompt) out.push({ role: "user", content: prompt });
  if (!out.length) out.push({ role: "user", content: "Hello" });
  return out;
}

export const PROVIDERS = [
  {
    id: "pollinations_text",
    name: "Pollinations Text",
    kinds: ["text"],
    needsKey: false,
    models: ["openai-fast", "openai", "openai-large", "mistral", "llama", "gemini", "gemini-large", "deepseek", "qwen-coder"],
    async generate({ prompt, model, system, history }) {
      const messages = toOpenAIMessages(history, prompt, system);
      const res = await fetch("https://text.pollinations.ai/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: model || "openai-fast", messages })
      });
      if (!res.ok) {
        const url = `https://text.pollinations.ai/${encodeURIComponent(lastUser(history, prompt))}?model=${encodeURIComponent(model || "openai-fast")}`;
        const fallback = await fetch(url);
        if (!fallback.ok) throw new Error(await readError(fallback));
        return { text: await fallback.text() };
      }
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        const data = await res.json();
        return { text: data.choices?.[0]?.message?.content || data.text || JSON.stringify(data) };
      }
      return { text: await res.text() };
    }
  },
  {
    id: "pollinations_image",
    name: "Pollinations Image",
    kinds: ["image"],
    needsKey: false,
    models: ["flux", "flux-realism", "flux-anime", "flux-3d", "turbo", "sana", "gptimage", "kontext", "seedream", "zimage"],
    async generate({ prompt, model, width, height, seed, key }) {
      const params = new URLSearchParams({
        model: model || "flux",
        width: String(width || 1024),
        height: String(height || 1024),
        nologo: "true",
        enhance: "false",
        seed: String(seed ?? Math.floor(Math.random() * 1e9))
      });
      if (key) params.set("key", key);
      const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${params}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(await readError(res));
      const blob = await res.blob();
      return {
        text: `Generated with ${model || "flux"} · ${width}×${height}`,
        attachments: [{ blob, mime: blob.type || "image/jpeg", name: `${slug(prompt)}.jpg`, kind: "image" }]
      };
    }
  },
  {
    id: "pollinations_video",
    name: "Pollinations Video",
    kinds: ["video"],
    needsKey: false,
    models: ["wan", "wan-fast", "veo", "seedance", "ltx-2"],
    async generate({ prompt, model, key }) {
      const params = new URLSearchParams({ model: model || "wan-fast" });
      if (key) params.set("key", key);
      const urls = [
        `https://gen.pollinations.ai/video/${encodeURIComponent(prompt)}?${params}`,
        `https://video.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${params}`
      ];
      let lastErr = "Video request failed";
      for (const url of urls) {
        try {
          const res = await fetch(url);
          if (!res.ok) { lastErr = await readError(res); continue; }
          const blob = await res.blob();
          if (!blob.size || !(blob.type || "").includes("video") && blob.size < 1000) {
            lastErr = "Provider returned a non-video payload (rate limit or auth required).";
            continue;
          }
          return {
            text: `Video generated with ${model || "wan-fast"}`,
            attachments: [{ blob, mime: blob.type || "video/mp4", name: `${slug(prompt)}.mp4`, kind: "video" }]
          };
        } catch (e) {
          lastErr = e.message;
        }
      }
      throw new Error(lastErr);
    }
  },
  {
    id: "puter_image",
    name: "Puter.js Image",
    kinds: ["image"],
    needsKey: false,
    models: ["default", "flux", "gpt-image", "sdxl"],
    note: "Opens a Puter consent dialog on first use. No developer API key.",
    async generate({ prompt, model }) {
      if (!window.puter?.ai?.txt2img) {
        throw new Error("Puter.js is not loaded yet. Open Settings and enable Puter, then retry.");
      }
      const opts = model && model !== "default" ? { model } : undefined;
      const result = await window.puter.ai.txt2img(prompt, opts);
      let blob;
      if (result instanceof Blob) blob = result;
      else if (typeof result === "string") {
        const res = await fetch(result);
        blob = await res.blob();
      } else if (result?.src || result?.url) {
        const res = await fetch(result.src || result.url);
        blob = await res.blob();
      } else {
        throw new Error("Unexpected Puter.js response. Try another model.");
      }
      return {
        text: `Puter image · ${model || "default"}`,
        attachments: [{ blob, mime: blob.type || "image/png", name: `${slug(prompt)}.png`, kind: "image" }]
      };
    }
  },
  {
    id: "groq",
    name: "Groq",
    kinds: ["text"],
    needsKey: true,
    keyName: "groq",
    docs: "https://console.groq.com/keys",
    models: ["llama-3.1-8b-instant", "llama-3.3-70b-versatile", "openai/gpt-oss-20b", "openai/gpt-oss-120b", "qwen/qwen3-32b"],
    async generate({ prompt, model, system, history, settings }) {
      const key = getKey(settings, "groq");
      if (!key) throw new Error("Add a Groq API key in Settings.");
      return chatCompletions("https://api.groq.com/openai/v1/chat/completions", key, {
        model: model || "llama-3.1-8b-instant",
        messages: toOpenAIMessages(history, prompt, system)
      });
    }
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    kinds: ["text"],
    needsKey: true,
    keyName: "openrouter",
    docs: "https://openrouter.ai/keys",
    models: [
      "openrouter/auto",
      "meta-llama/llama-3.1-8b-instruct:free",
      "google/gemma-3-27b-it:free",
      "qwen/qwen3-8b:free",
      "mistralai/mistral-small-3.1-24b-instruct:free"
    ],
    async generate({ prompt, model, system, history, settings }) {
      const key = getKey(settings, "openrouter");
      if (!key) throw new Error("Add an OpenRouter API key in Settings.");
      return chatCompletions("https://openrouter.ai/api/v1/chat/completions", key, {
        model: model || "openrouter/auto",
        messages: toOpenAIMessages(history, prompt, system)
      });
    }
  },
  {
    id: "gemini",
    name: "Google Gemini",
    kinds: ["text"],
    needsKey: true,
    keyName: "gemini",
    docs: "https://aistudio.google.com/apikey",
    models: ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash-lite"],
    async generate({ prompt, model, system, history, settings }) {
      const key = getKey(settings, "gemini");
      if (!key) throw new Error("Add a Google AI Studio API key in Settings.");
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model || "gemini-2.0-flash"}:generateContent?key=${encodeURIComponent(key)}`;
      const contents = [];
      for (const m of history || []) {
        if (!m.text) continue;
        contents.push({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.text }] });
      }
      contents.push({ role: "user", parts: [{ text: prompt }] });
      const body = { contents };
      if (system) body.systemInstruction = { parts: [{ text: system }] };
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(await readError(res));
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || JSON.stringify(data);
      return { text };
    }
  },
  {
    id: "huggingface",
    name: "Hugging Face",
    kinds: ["text", "image"],
    needsKey: true,
    keyName: "huggingface",
    docs: "https://huggingface.co/settings/tokens",
    models: {
      text: ["Qwen/Qwen2.5-7B-Instruct", "meta-llama/Llama-3.2-3B-Instruct", "mistralai/Mistral-7B-Instruct-v0.3"],
      image: ["black-forest-labs/FLUX.1-schnell", "stabilityai/stable-diffusion-xl-base-1.0"]
    },
    async generate({ prompt, model, kind, settings }) {
      const key = getKey(settings, "huggingface");
      if (!key) throw new Error("Add a Hugging Face token in Settings.");
      const mdl = model || (kind === "image" ? "black-forest-labs/FLUX.1-schnell" : "Qwen/Qwen2.5-7B-Instruct");
      const res = await fetch(`https://api-inference.huggingface.co/models/${mdl}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(kind === "image" ? { inputs: prompt } : { inputs: prompt, parameters: { max_new_tokens: 512 } })
      });
      if (!res.ok) throw new Error(await readError(res));
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("image") || kind === "image") {
        const blob = await res.blob();
        return { text: `HF image · ${mdl}`, attachments: [{ blob, mime: blob.type || "image/png", name: `${slug(prompt)}.png`, kind: "image" }] };
      }
      const data = await res.json();
      const text = Array.isArray(data) ? (data[0]?.generated_text || JSON.stringify(data)) : (data.generated_text || JSON.stringify(data));
      return { text };
    }
  },
  {
    id: "cerebras",
    name: "Cerebras",
    kinds: ["text"],
    needsKey: true,
    keyName: "cerebras",
    docs: "https://cloud.cerebras.ai",
    models: ["llama3.1-8b", "llama-3.3-70b"],
    async generate({ prompt, model, system, history, settings }) {
      const key = getKey(settings, "cerebras");
      if (!key) throw new Error("Add a Cerebras API key in Settings.");
      return chatCompletions("https://api.cerebras.ai/v1/chat/completions", key, {
        model: model || "llama3.1-8b",
        messages: toOpenAIMessages(history, prompt, system)
      });
    }
  },
  {
    id: "custom_openai",
    name: "Custom OpenAI-compatible",
    kinds: ["text"],
    needsKey: true,
    keyName: "custom",
    models: ["gpt-4o-mini", "llama-3.1-8b-instruct"],
    async generate({ prompt, model, system, history, settings }) {
      const key = getKey(settings, "custom");
      const base = (settings.customBase || "").replace(/\/$/, "");
      if (!base) throw new Error("Set a custom base URL in Settings, e.g. https://api.groq.com/openai/v1");
      return chatCompletions(`${base}/chat/completions`, key, {
        model: model || "gpt-4o-mini",
        messages: toOpenAIMessages(history, prompt, system)
      });
    }
  }
];

export function providersFor(kind) {
  return PROVIDERS.filter((p) => p.kinds.includes(kind));
}

export function getProvider(id) {
  return PROVIDERS.find((p) => p.id === id);
}

export function modelsFor(provider, kind) {
  if (!provider) return [];
  if (Array.isArray(provider.models)) return provider.models;
  return provider.models[kind] || provider.models.text || [];
}

function slug(text) {
  return (text || "generation").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "generation";
}

export async function ensurePuter(enabled) {
  if (!enabled) return;
  if (window.puter) return;
  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://js.puter.com/v2/";
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error("Failed to load Puter.js"));
    document.head.appendChild(s);
  });
}
