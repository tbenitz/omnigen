# OmniGen

A static GitHub Pages playground that talks to several **free / free-tier AI APIs** for **text**, **image**, and **video** generation from one UI.

You can send the same prompt to multiple providers, compare the replies, keep a local thread history, and export whatever you want to keep.

## Live site

After GitHub Pages is enabled:

**https://tbenitz.github.io/omnigen/**

Enable it with: repo **Settings → Pages → Deploy from branch → `main` / `/ (root)`**.

## What it does

- Text, image, and video modes
- Multi-provider compare in one thread
- History stored in **IndexedDB** (messages + image/video blobs)
- Persistent banner: clearing cache / site data **deletes everything**
- Export choices:
  - ZIP of thread markdown + attachments
  - ZIP of attachments only
  - JSON without media
  - JSON with base64 attachments
- Import a previously exported JSON bundle
- Optional BYOK keys kept in `localStorage` on this device only

## Providers

Works with **no key** (rate-limited, public endpoints):

| Provider | Modes |
|---|---|
| [Pollinations](https://pollinations.ai) text | Text |
| Pollinations image | Image |
| Pollinations video | Video |
| [Puter.js](https://developer.puter.com) (opt-in) | Image |

Bring-your-own-key (free tiers, browser CORS permitting):

- Groq
- OpenRouter (`:free` models)
- Google Gemini (AI Studio)
- Hugging Face Inference
- Cerebras
- Any custom OpenAI-compatible base URL

Keys never leave the browser except as `Authorization` headers to the provider you selected.

## Data warning

This is a static site. There is no server and no account.

- Threads live in IndexedDB under this origin
- Keys live in localStorage
- A cache clear, “clear site data”, or another browser profile starts from empty
- Export anything you care about

## Local run

Any static server:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## Limits you should expect

- Public Pollinations calls are IP / hourly rate limited
- Video endpoints are the least reliable of the free options and may require a Pollinations key
- Some BYOK hosts block browser origins (CORS). The UI records that error on the thread so you can see which provider failed
- IndexedDB quotas vary by browser; the header shows an estimate when the Storage API exists

## License

MIT
