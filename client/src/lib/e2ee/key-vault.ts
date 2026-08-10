const DATABASE_NAME = "umbravia-e2ee-v1";
const STORE_NAME = "wrapped-device-state";

export interface E2eeKeyVault {
  put(deviceId: string, wrappedState: string): Promise<void>;
  get(deviceId: string): Promise<string | null>;
  remove(deviceId: string): Promise<void>;
}

function assertWrappedState(value: string) {
  if (!value.startsWith("wrapped-v1:") || value.length > 262_144) {
    throw new Error("Only wrapped E2EE device state can be persisted");
  }
}

function openDatabase(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB) {
    return Promise.reject(new Error("IndexedDB is not available"));
  }
  return new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transaction<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = database.transaction(STORE_NAME, mode);
      const request = operation(tx.objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    database.close();
  }
}

export class IndexedDbE2eeKeyVault implements E2eeKeyVault {
  async put(deviceId: string, wrappedState: string) {
    assertWrappedState(wrappedState);
    await transaction("readwrite", (store) =>
      store.put(wrappedState, deviceId),
    );
  }

  async get(deviceId: string) {
    const value = await transaction<unknown>("readonly", (store) =>
      store.get(deviceId),
    );
    if (value === undefined) return null;
    if (typeof value !== "string") {
      throw new Error("Invalid E2EE key vault entry");
    }
    assertWrappedState(value);
    return value;
  }

  async remove(deviceId: string) {
    await transaction("readwrite", (store) => store.delete(deviceId));
  }
}
