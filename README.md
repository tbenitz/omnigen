# OmniGen

A static GitHub Pages playground for **keyless** text, image, and video generation.

No API keys to paste. Providers that started charging (Pollinations 402) or that require a personal key were removed.

## Live site

**https://tbenitz.github.io/omnigen/**

Enable Pages: repo **Settings → Pages → Deploy from branch → `main` / `/ (root)`**.

## Providers (verified keyless)

| Provider | Mode | How it stays free |
|---|---|---|
| UncloseAI Qwen (`hermes.ai.unturf.com`) | Text | Public chat endpoint, no key |
| AI Horde | Text + image | Built-in anonymous token `0000000000` |
| DevToolBox Llama | Text | Public Cloudflare Worker, no key |
| Puter.js | Text + image + video | No developer key. First use may show a Continue dialog. Light text/image use is free; video often is not |

Video is the weak spot. There is currently no reliable, always-on, keyless free video API. Puter Video is included and will error honestly if credits are gone.

## Data

Threads live in this browser’s IndexedDB. Clearing cache deletes them. Export before you wipe site data.

## Local run

```bash
python3 -m http.server 8080
```

## License

MIT
