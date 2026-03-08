const DB_NAME    = "visitor-clips";
const DB_VERSION = 1;
const STORE      = "clips";
const MAX_CLIPS  = 50;

export interface ClipRecord {
  id: string;
  timestamp: number;   // Date.now() at moment of detection
  faceLabel: string;
  blob: Blob;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("timestamp", "timestamp", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror  = () => reject(req.error);
  });
}

export async function saveClip(clip: ClipRecord): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    store.put(clip);
    tx.oncomplete = () => { pruneOldClips(db).then(resolve); };
    tx.onerror    = () => reject(tx.error);
  });
}

/** Find clips whose timestamp falls within windowMs of the target */
export async function getClipsNear(
  timestamp: number,
  windowMs = 20_000,
): Promise<ClipRecord[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE, "readonly");
    const idx   = tx.objectStore(STORE).index("timestamp");
    const range = IDBKeyRange.bound(timestamp - windowMs, timestamp + windowMs);
    const req   = idx.getAll(range);
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror   = () => reject(req.error);
  });
}

async function pruneOldClips(db: IDBDatabase): Promise<void> {
  return new Promise((resolve) => {
    const tx    = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const count = store.count();
    count.onsuccess = () => {
      if (count.result <= MAX_CLIPS) { resolve(); return; }
      let toDelete = count.result - MAX_CLIPS;
      const cursor = store.index("timestamp").openCursor(); // ascending = oldest first
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (!c || toDelete <= 0) { resolve(); return; }
        c.delete();
        toDelete--;
        c.continue();
      };
    };
  });
}
