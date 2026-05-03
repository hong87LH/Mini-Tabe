export const dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('bitable_db', 1);
    request.onupgradeneeded = () => {
        request.result.createObjectStore('handles');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
});

export async function setHandle(key: string, handle: any) {
    const db = await dbPromise;
    const tx = db.transaction('handles', 'readwrite');
    tx.objectStore('handles').put(handle, key);
    return new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = reject;
    });
}

export async function getHandle(key: string): Promise<any> {
    const db = await dbPromise;
    const tx = db.transaction('handles', 'readonly');
    const req = tx.objectStore('handles').get(key);
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = reject;
    });
}
