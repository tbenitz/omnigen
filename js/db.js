const DB_NAME = "omnigen-v1";
const DB_VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("threads")) {
        const s = db.createObjectStore("threads", { keyPath: "id" });
        s.createIndex("updatedAt", "updatedAt");
      }
      if (!db.objectStoreNames.contains("messages")) {
        const s = db.createObjectStore("messages", { keyPath: "id" });
        s.createIndex("threadId", "threadId");
      }
      if (!db.objectStoreNames.contains("attachments")) {
        const s = db.createObjectStore("attachments", { keyPath: "id" });
        s.createIndex("messageId", "messageId");
        s.createIndex("threadId", "threadId");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function uid(prefix = "id") {
  return `${prefix}_${crypto.randomUUID()}`;
}

export const db = {
  async allThreads() {
    const database = await openDb();
    return new Promise((resolve, reject) => {
      const req = database.transaction("threads").objectStore("threads").getAll();
      req.onsuccess = () => {
        const rows = req.result.sort((a, b) => b.updatedAt - a.updatedAt);
        resolve(rows);
      };
      req.onerror = () => reject(req.error);
    });
  },

  async getThread(id) {
    const database = await openDb();
    return new Promise((resolve, reject) => {
      const req = database.transaction("threads").objectStore("threads").get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },

  async putThread(thread) {
    const database = await openDb();
    const tx = database.transaction("threads", "readwrite");
    tx.objectStore("threads").put(thread);
    await txDone(tx);
    return thread;
  },

  async deleteThread(id) {
    const database = await openDb();
    const messages = await this.messagesFor(id);
    const tx = database.transaction(["threads", "messages", "attachments"], "readwrite");
    tx.objectStore("threads").delete(id);
    for (const m of messages) tx.objectStore("messages").delete(m.id);
    const attReq = tx.objectStore("attachments").index("threadId").getAll(id);
    attReq.onsuccess = () => {
      for (const a of attReq.result) tx.objectStore("attachments").delete(a.id);
    };
    await txDone(tx);
  },

  async messagesFor(threadId) {
    const database = await openDb();
    return new Promise((resolve, reject) => {
      const req = database.transaction("messages").objectStore("messages").index("threadId").getAll(threadId);
      req.onsuccess = () => {
        resolve(req.result.sort((a, b) => a.createdAt - b.createdAt));
      };
      req.onerror = () => reject(req.error);
    });
  },

  async putMessage(message) {
    const database = await openDb();
    const tx = database.transaction("messages", "readwrite");
    tx.objectStore("messages").put(message);
    await txDone(tx);
    return message;
  },

  async attachmentsForMessage(messageId) {
    const database = await openDb();
    return new Promise((resolve, reject) => {
      const req = database.transaction("attachments").objectStore("attachments").index("messageId").getAll(messageId);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  async attachmentsForThread(threadId) {
    const database = await openDb();
    return new Promise((resolve, reject) => {
      const req = database.transaction("attachments").objectStore("attachments").index("threadId").getAll(threadId);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  async allAttachments() {
    const database = await openDb();
    return new Promise((resolve, reject) => {
      const req = database.transaction("attachments").objectStore("attachments").getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  async putAttachment(att) {
    const database = await openDb();
    const tx = database.transaction("attachments", "readwrite");
    tx.objectStore("attachments").put(att);
    await txDone(tx);
    return att;
  },

  async exportBundle(threadIds, { includeAttachments = true } = {}) {
    const threads = [];
    for (const id of threadIds) {
      const thread = await this.getThread(id);
      if (!thread) continue;
      const messages = await this.messagesFor(id);
      const attachments = includeAttachments ? await this.attachmentsForThread(id) : [];
      threads.push({ thread, messages, attachments });
    }
    return { exportedAt: new Date().toISOString(), version: 1, threads };
  }
};

export { uid };

export async function storageStats() {
  if (!navigator.storage?.estimate) return null;
  const est = await navigator.storage.estimate();
  return {
    used: est.usage || 0,
    quota: est.quota || 0
  };
}
