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

const HORDE_KEY = "0000000000";
const HORDE_AGENT = "OmniGen:1.1:github.com/tbenitz/omnigen";

async function readError(res) {
  const text = await res.text().catch(() => "");
  let extra = text.slice(0, 400);
  try {
    const j = JSON.parse(text);
    extra = j.message || j.error?.message || j.error || extra;
  } catch {}
  return `${res.status} ${res.statusText}${extra ? " \u2014 " + extra : ""}`;
}

function lastUser(history, prompt) {
  if (prompt) return prompt;
  const last = [...(history || [])].reverse().find((m) => m.role === "user");
  return last?.text || "";
}

function toPrompt(history, prompt, system) {
  const parts = [];
  if (system) parts.push(`System: ${system}`);
  for (const m of history || []) {
    if (!m.text) continue;
    parts.push(`${m.role === "assistant" ? "Assistant" : "User"}: ${m.text}`);
  }
  parts.push(`User: ${prompt}`);
  parts.push("Assistant:");
  return parts.join("\n");
}

function slug(text) {
  return (text || "generation").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "generation";
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function hordePoll(statusUrl, timeoutMs = 180000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(statusUrl, { headers: { apikey: HORDE_KEY, "Client-Agent": HORDE_AGENT } });
    if (!res.ok) throw new Error(await readError(res));
    const data = await res.json();
    if (data.faulted) throw new Error("AI Horde marked this job as faulted. Try again.");
    if (data.done) return data;
    await sleep(data.wait_time ? Math.min(8000, Math.max(1500, data.wait_time * 400)) : 2500);
  }
  throw new Error("Timed out waiting on the volunteer queue. Try again in a minute.");
}

async function blobFromUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("IMAGE_URL_ONLY:" + url);
  const blob = await res.blob();
  if (blob.size < 32) throw new Error("IMAGE_URL_ONLY:" + url);
  return blob;
}

const ANSWER_SYS = "If you reason, you may show the reasoning. Always finish with a complete answer. End with a line in this exact form:\nFINAL: <the answer>";

function formatThinkAnswer(raw, extraReasoning) {
  const text = String(raw || "").trim();
  const extra = String(extraReasoning || "").trim();
  const matches = [...text.matchAll(/(?:^|\n)\s*(?:FINAL(?:\s*ANSWER)?|Final Answer)\s*[:\-]\s*(.+)/gi)];
  const answer = matches.length ? matches[matches.length - 1][1].trim() : "";
  const looksLikeThink = /here'?s a thinking process|^\s*\d+\.\s+\*\*/i.test(text);
  if (!answer && !looksLikeThink && !extra) return text;
  const thinking = [extra, text.replace(/(?:^|\n)\s*(?:FINAL(?:\s*ANSWER)?|Final Answer)\s*[:\-]\s*.+/gi, "").trim()]
    .filter(Boolean)
    .join("\n\n");
  if (answer) return `Answer\n${answer}\n\n\u2014\u2014 thinking \u2014\u2014\n${thinking}`;
  return thinking;
}

export const PROVIDERS = [
  {
    id: "unclose_qwen",
    name: "UncloseAI Qwen",
    kinds: ["text"],
    needsKey: false,
    models: ["Lorbus/Qwen3.6-27B-int4-AutoRound"],
    note: "Public keyless chat endpoint. No signup.",
    async generate({ prompt, model, system, history }) {
      const messages = [];
      messages.push({ role: "system", content: system ? `${ANSWER_SYS}\n\n${system}` : ANSWER_SYS });
      for (const m of history || []) {
        if (!m.text) continue;
        messages.push({ role: m.role === "assistant" ? "assistant" : "user", content: m.text });
      }
      messages.push({ role: "user", content: prompt });
      const res = await fetch("https://hermes.ai.unturf.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: model || "Lorbus/Qwen3.6-27B-int4-AutoRound",
          messages,
          max_tokens: 4096
        })
      });
      if (!res.ok) throw new Error(await readError(res));
      const data = await res.json();
      const msg = data.choices?.[0]?.message || {};
      const text = msg.content || JSON.stringify(data);
      return { text: formatThinkAnswer(text, msg.reasoning || msg.reasoning_content) };
    }
  },
  {
    id: "horde_text",
    name: "AI Horde Text",
    kinds: ["text"],
    needsKey: false,
    models: ["auto", "aphrodite/TheDrummer/Cydonia-24B-v4.3", "koboldcpp/L3-8B-Stheno-v3.2"],
    note: "Volunteer GPUs. Anonymous access is built in. Queue can take a while.",
    async generate({ prompt, model, system, history }) {
      const body = {
        prompt: toPrompt(history, prompt, system),
        trusted_workers: false,
        slow_workers: true,
        models: !model || model === "auto" ? [] : [model]
      };
      const res = await fetch("https://aihorde.net/api/v2/generate/text/async", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: HORDE_KEY,
          "Client-Agent": HORDE_AGENT
        },
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error(await readError(res));
      const job = await res.json();
      if (!job.id) throw new Error("Horde did not return a job id.");
      const data = await hordePoll(`https://aihorde.net/api/v2/generate/text/status/${job.id}`);
      const text = data.generations?.[0]?.text || JSON.stringify(data);
      return { text: String(text).trim() };
    }
  },
  {
    id: "toolbox_text",
    name: "DevToolBox Llama",
    kinds: ["text"],
    needsKey: false,
    models: ["llama-3.2-3b-instruct"],
    note: "Public Cloudflare Worker. No key.",
    async generate({ prompt, history }) {
      const full = lastUser(history, prompt);
      const res = await fetch("https://devtoolbox-api.devtoolbox-api.workers.dev/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: full })
      });
      if (!res.ok) throw new Error(await readError(res));
      const data = await res.json();
      return { text: data.response || data.text || JSON.stringify(data) };
    }
  },
  {
    id: "puter_text",
    name: "Puter Chat",
    kinds: ["text"],
    needsKey: false,
    models: ["default"],
    note: "No developer key. First use opens a Puter Continue dialog. Light use is free.",
    async generate({ prompt, system, history }) {
      if (!window.puter?.ai?.chat) throw new Error("Puter.js is not loaded yet. Wait a second and retry.");
      const messages = [];
      if (system) messages.push({ role: "system", content: system });
      for (const m of history || []) {
        if (!m.text) continue;
        messages.push({ role: m.role === "assistant" ? "assistant" : "user", content: m.text });
      }
      messages.push({ role: "user", content: prompt });
      const result = await window.puter.ai.chat(messages.length > 1 ? messages : prompt);
      const text = typeof result === "string" ? result : (result?.message?.content || result?.toString?.() || JSON.stringify(result));
      return { text: String(text) };
    }
  },
  {
    id: "horde_image",
    name: "AI Horde Image",
    kinds: ["image"],
    needsKey: false,
    models: ["AlbedoBase XL 3.1", "stable_diffusion", "Nova Anime XL"],
    note: "Volunteer Stable Diffusion workers. Anonymous. Can queue for 1-3 minutes.",
    async generate({ prompt, model, width, height, seed }) {
      const w = Math.max(64, Math.min(1024, Number(width) || 512));
      const h = Math.max(64, Math.min(1024, Number(height) || 512));
      const body = {
        prompt,
        nsfw: false,
        censor_nsfw: true,
        models: [model || "AlbedoBase XL 3.1"],
        params: {
          width: w - (w % 64),
          height: h - (h % 64),
          steps: 16,
          n: 1,
          seed: seed == null || Number.isNaN(Number(seed)) ? undefined : String(seed)
        }
      };
      const res = await fetch("https://aihorde.net/api/v2/generate/async", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: HORDE_KEY,
          "Client-Agent": HORDE_AGENT
        },
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error(await readError(res));
      const job = await res.json();
      if (!job.id) throw new Error("Horde did not return a job id.");
      const data = await hordePoll(`https://aihorde.net/api/v2/generate/status/${job.id}`, 240000);
      const gen = data.generations?.[0];
      if (!gen?.img) throw new Error("Horde finished without an image. Queue may be empty.");
      try {
        const blob = await blobFromUrl(gen.img);
        return {
          text: `Horde image \u00b7 ${gen.model || model || "unknown"}`,
          attachments: [{ blob, mime: blob.type || "image/webp", name: `${slug(prompt)}.webp`, kind: "image" }]
        };
      } catch (err) {
        if (String(err.message).startsWith("IMAGE_URL_ONLY:")) {
          return { text: `Image ready (temporary URL):\n${gen.img}` };
        }
        throw err;
      }
    }
  },
  {
    id: "puter_image",
    name: "Puter Image",
    kinds: ["image"],
    needsKey: false,
    models: ["default", "stabilityai/stable-diffusion-xl-base-1.0", "black-forest-labs/flux-1.1-pro", "gpt-image-1"],
    note: "No developer key. First use opens a Puter Continue dialog.",
    async generate({ prompt, model }) {
      if (!window.puter?.ai?.txt2img) throw new Error("Puter.js is not loaded yet. Wait a second and retry.");
      const opts = model && model !== "default" ? { model } : undefined;
      const result = await window.puter.ai.txt2img(prompt, opts);
      let blob;
      if (result instanceof Blob) blob = result;
      else if (typeof HTMLImageElement !== "undefined" && result instanceof HTMLImageElement) {
        const src = result.src;
        if (src.startsWith("data:")) {
          blob = await (await fetch(src)).blob();
        } else if (src) {
          try {
            blob = await (await fetch(src)).blob();
          } catch {
            const canvas = document.createElement("canvas");
            canvas.width = result.naturalWidth || 1024;
            canvas.height = result.naturalHeight || 1024;
            canvas.getContext("2d").drawImage(result, 0, 0);
            blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
          }
        }
      } else if (typeof result === "string") {
        blob = await (await fetch(result)).blob();
      } else if (result?.src || result?.url) {
        blob = await (await fetch(result.src || result.url)).blob();
      }
      if (!blob) throw new Error("Puter returned an unexpected image payload.");
      return {
        text: `Puter image \u00b7 ${model || "default"}`,
        attachments: [{ blob, mime: blob.type || "image/png", name: `${slug(prompt)}.png`, kind: "image" }]
      };
    }
  },
  {
    id: "puter_video",
    name: "Puter Video",
    kinds: ["video"],
    needsKey: false,
    models: ["default"],
    note: "No developer key. Free video credits are not guaranteed and this may fail.",
    async generate({ prompt }) {
      if (!window.puter?.ai?.txt2vid) throw new Error("Puter.js is not loaded yet. Wait a second and retry.");
      const result = await window.puter.ai.txt2vid(prompt);
      let blob;
      if (result instanceof Blob) blob = result;
      else if (typeof HTMLVideoElement !== "undefined" && result instanceof HTMLVideoElement && result.src) {
        blob = await (await fetch(result.src)).blob();
      } else if (typeof result === "string") {
        blob = await (await fetch(result)).blob();
      } else if (result?.src || result?.url) {
        blob = await (await fetch(result.src || result.url)).blob();
      }
      if (!blob) throw new Error("Puter video failed. There is currently no reliable keyless free video API.");
      return {
        text: "Puter video",
        attachments: [{ blob, mime: blob.type || "video/mp4", name: `${slug(prompt)}.mp4`, kind: "video" }]
      };
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

export async function ensurePuter(enabled = true) {
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
