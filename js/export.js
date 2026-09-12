import { db } from "./db.js";

function downloadBlob(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

function safeName(s) {
  return (s || "untitled").replace(/[<>:"/\\|?*]+/g, "-").slice(0, 80);
}

function threadMarkdown(thread, messages) {
  const lines = [
    `# ${thread.title || "Untitled thread"}`,
    "",
    `- Mode: ${thread.mode}`,
    `- Created: ${new Date(thread.createdAt).toISOString()}`,
    `- Updated: ${new Date(thread.updatedAt).toISOString()}`,
    ""
  ];
  for (const m of messages) {
    lines.push(`## ${m.role}${m.providerId ? ` · ${m.providerId}` : ""}${m.model ? ` · ${m.model}` : ""}`);
    lines.push("");
    lines.push(m.text || "");
    lines.push("");
  }
  return lines.join("\n");
}

async function blobToBase64(blob) {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function runExport({ threadIds, mode, includeAttachments, includeText }) {
  if (!threadIds.length) throw new Error("Select at least one thread.");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  if (mode === "json-text") {
    const bundle = await db.exportBundle(threadIds, { includeAttachments: false });
    downloadBlob(new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" }), `omnigen-threads-${stamp}.json`);
    return;
  }

  if (mode === "json-full") {
    const bundle = await db.exportBundle(threadIds, { includeAttachments: true });
    const serializable = {
      exportedAt: bundle.exportedAt,
      version: bundle.version,
      threads: []
    };
    for (const t of bundle.threads) {
      const attachments = [];
      for (const a of t.attachments) {
        attachments.push({
          id: a.id,
          messageId: a.messageId,
          threadId: a.threadId,
          kind: a.kind,
          mime: a.mime,
          name: a.name,
          dataBase64: includeAttachments ? await blobToBase64(a.blob) : undefined
        });
      }
      serializable.threads.push({ thread: t.thread, messages: t.messages, attachments });
    }
    downloadBlob(new Blob([JSON.stringify(serializable)], { type: "application/json" }), `omnigen-full-${stamp}.json`);
    return;
  }

  if (typeof JSZip === "undefined") throw new Error("JSZip failed to load.");
  const zip = new JSZip();

  if (mode === "attachments-only") {
    for (const id of threadIds) {
      const thread = await db.getThread(id);
      const atts = await db.attachmentsForThread(id);
      const folder = zip.folder(safeName(thread?.title || id));
      if (!atts.length) folder.file("NO_ATTACHMENTS.txt", "This thread has no images or videos.");
      for (const a of atts) folder.file(a.name || `${a.id}.bin`, a.blob);
    }
    const blob = await zip.generateAsync({ type: "blob" });
    downloadBlob(blob, `omnigen-attachments-${stamp}.zip`);
    return;
  }

  for (const id of threadIds) {
    const thread = await db.getThread(id);
    const messages = await db.messagesFor(id);
    const atts = includeAttachments ? await db.attachmentsForThread(id) : [];
    const folder = zip.folder(safeName(thread?.title || id));
    if (includeText) folder.file("thread.md", threadMarkdown(thread, messages));
    if (includeText) folder.file("thread.json", JSON.stringify({ thread, messages }, null, 2));
    if (includeAttachments && atts.length) {
      const media = folder.folder("attachments");
      for (const a of atts) media.file(a.name || `${a.id}.bin`, a.blob);
    }
  }
  const blob = await zip.generateAsync({ type: "blob" });
  downloadBlob(blob, `omnigen-export-${stamp}.zip`);
}
