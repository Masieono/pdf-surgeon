const DB_NAME = "pdfsurgery";
const DB_VERSION = 2;
const STORE_FILE_BYTES = "fileBytes";
const STORE_THUMB_CACHE = "thumbCache";

let dbPromise = null;

function openDb() {
  if (typeof indexedDB === "undefined") {
    throw new Error("IndexedDB unavailable");
  }

  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_FILE_BYTES)) {
        db.createObjectStore(STORE_FILE_BYTES, { keyPath: "fileId" });
      }
      if (!db.objectStoreNames.contains(STORE_THUMB_CACHE)) {
        const thumbStore = db.createObjectStore(STORE_THUMB_CACHE, { keyPath: "cacheKey" });
        thumbStore.createIndex("fileId", "fileId", { unique: false });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error ?? new Error("Failed to open IndexedDB"));
    };
  });

  return dbPromise;
}

async function runTransaction(storeName, mode, runner) {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let settled = false;
    let request = null;
    let requestResult = null;

    try {
      request = runner(store);
    } catch (error) {
      reject(error);
      return;
    }

    tx.onabort = () => {
      if (settled) {
        return;
      }
      settled = true;
      reject(tx.error ?? new Error("IndexedDB transaction aborted"));
    };
    tx.onerror = () => {
      if (settled) {
        return;
      }
      settled = true;
      reject(tx.error ?? new Error("IndexedDB transaction failed"));
    };
    tx.oncomplete = () => {
      if (settled) {
        return;
      }
      settled = true;
      if (request == null) {
        resolve(undefined);
        return;
      }
      resolve(requestResult ?? null);
    };

    if (request != null) {
      request.onsuccess = () => {
        requestResult = request.result;
      };
      request.onerror = () => {
        // Transaction handlers surface the final failure.
      };
    }
  });
}

export async function idbPutFile(fileId, { bytes, mime, originalName }) {
  const record = {
    fileId,
    bytes,
    mime,
    originalName,
    createdAt: Date.now(),
  };

  await runTransaction(STORE_FILE_BYTES, "readwrite", (store) => store.put(record));
}

export async function idbGetFile(fileId) {
  const result = await runTransaction(STORE_FILE_BYTES, "readonly", (store) => store.get(fileId));
  return result ?? null;
}

export async function idbDeleteFile(fileId) {
  await runTransaction(STORE_FILE_BYTES, "readwrite", (store) => store.delete(fileId));
  await idbDeleteThumbsByFile(fileId);
}

export async function idbPutThumb({
  cacheKey,
  fileId,
  pageIndex,
  rotation,
  thumbWidthPx,
  width,
  height,
  dataUrl,
}) {
  const record = {
    cacheKey,
    fileId,
    pageIndex,
    rotation,
    thumbWidthPx,
    width,
    height,
    dataUrl,
    updatedAt: Date.now(),
  };
  await runTransaction(STORE_THUMB_CACHE, "readwrite", (store) => store.put(record));
}

export async function idbGetThumb(cacheKey) {
  const result = await runTransaction(STORE_THUMB_CACHE, "readonly", (store) => store.get(cacheKey));
  return result ?? null;
}

export async function idbDeleteThumbsByFile(fileId) {
  await runTransaction(STORE_THUMB_CACHE, "readwrite", (store) => {
    const index = store.index("fileId");
    const range = IDBKeyRange.only(fileId);
    const request = index.openCursor(range);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        return;
      }
      cursor.delete();
      cursor.continue();
    };
    return request;
  });
}

export async function idbClearAll() {
  await runTransaction(STORE_FILE_BYTES, "readwrite", (store) => store.clear());
  await runTransaction(STORE_THUMB_CACHE, "readwrite", (store) => store.clear());
}
