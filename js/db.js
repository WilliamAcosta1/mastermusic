/* ==========================================================
   MusicDB — almacenamiento persistente en IndexedDB.
   Guarda los archivos de audio importados (como Blob) + metadatos
   para que la biblioteca sobreviva a recargas y cierres.
   ========================================================== */
window.MusicDB = (() => {
  'use strict';

  const DB_NAME = 'mastermusic';
  const STORE = 'tracks';
  const VERSION = 1;
  let dbPromise = null;

  const open = () => {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) { reject(new Error('IndexedDB no soportado')); return; }
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  };

  const run = async (mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      const req = fn(store);
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  };

  return {
    put: (record) => run('readwrite', (s) => s.put(record)),
    getAll: () => run('readonly', (s) => s.getAll()),
    delete: (id) => run('readwrite', (s) => s.delete(id)),
    clear: () => run('readwrite', (s) => s.clear()),
  };
})();
