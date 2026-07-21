const DB_NAME = 'f-tools-pdfs';
const DB_VERSION = 1;
const STORE_NAME = 'pdfs';

export const DEFAULT_PDF_HANDOFF_MAX_AGE_MS = 60 * 60 * 1000;

function openPdfsDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withPdfsDb(operation) {
  const db = await openPdfsDb();
  try {
    return await operation(db);
  } finally {
    db.close();
  }
}

export function isExpiredPdfHandoff(record, cutoff) {
  const createdAt = Number(record?.createdAt);
  return !Number.isFinite(createdAt) || createdAt < cutoff;
}

export function putPdfHandoff(record) {
  return withPdfsDb((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

export function deletePdfHandoff(id) {
  return withPdfsDb((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

export function takePdfHandoff(id) {
  return withPdfsDb((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(id);
    let record = null;

    request.onsuccess = () => {
      record = request.result || null;
      if (record) store.delete(id);
    };
    tx.oncomplete = () => resolve(record);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

export function cleanupExpiredPdfHandoffs(maxAgeMs = DEFAULT_PDF_HANDOFF_MAX_AGE_MS) {
  const cutoff = Date.now() - maxAgeMs;
  return withPdfsDb((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.openCursor();
    let deletedCount = 0;

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if (isExpiredPdfHandoff(cursor.value, cutoff)) {
        cursor.delete();
        deletedCount += 1;
      }
      cursor.continue();
    };
    tx.oncomplete = () => resolve(deletedCount);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}
