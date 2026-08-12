import type { ChatSessionRecord } from "./models";

const DATABASE_NAME = "dcr-controller-chat";
const DATABASE_VERSION = 1;
const SESSION_STORE = "sessions";

export class ChatSessionStorageError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ChatSessionStorageError";
  }
}

/** Persists resumable chat state independently from backend-owned history. */
export class ChatSessionRepository {
  private databasePromise?: Promise<IDBDatabase>;
  private readonly factory: IDBFactory | undefined;
  private readonly databaseName: string;

  constructor(
    factory: IDBFactory | undefined = globalThis.indexedDB,
    databaseName = DATABASE_NAME,
  ) {
    this.factory = factory;
    this.databaseName = databaseName;
  }

  async list(): Promise<ChatSessionRecord[]> {
    const records = await this.read<ChatSessionRecord[]>((store) => store.getAll());
    return records.sort((left, right) => right.updatedAt - left.updatedAt);
  }

  get(id: string): Promise<ChatSessionRecord | undefined> {
    return this.read<ChatSessionRecord | undefined>((store) => store.get(id));
  }

  async put(record: ChatSessionRecord): Promise<void> {
    await this.write((store) => store.put(record));
  }

  save(record: ChatSessionRecord): Promise<void> {
    return this.put(record);
  }

  async delete(id: string): Promise<void> {
    await this.write((store) => store.delete(id));
  }

  remove(id: string): Promise<void> {
    return this.delete(id);
  }

  async clear(): Promise<void> {
    await this.write((store) => store.clear());
  }

  close(): void {
    void this.databasePromise
      ?.then((database) => database.close())
      .catch(() => undefined);
    this.databasePromise = undefined;
  }

  private async read<T>(operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const database = await this.open();
    const transaction = database.transaction(SESSION_STORE, "readonly");
    const completed = transactionCompleted(transaction);
    const result = await requestResult(operation(transaction.objectStore(SESSION_STORE)));
    await completed;
    return result;
  }

  private async write(operation: (store: IDBObjectStore) => IDBRequest): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(SESSION_STORE, "readwrite");
    const completed = transactionCompleted(transaction);
    await requestResult(operation(transaction.objectStore(SESSION_STORE)));
    await completed;
  }

  private open(): Promise<IDBDatabase> {
    if (!this.factory) {
      return Promise.reject(
        new ChatSessionStorageError("IndexedDB is unavailable in this browser."),
      );
    }
    this.databasePromise ??= new Promise((resolve, reject) => {
      const request = this.factory!.open(this.databaseName, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        const store = database.objectStoreNames.contains(SESSION_STORE)
          ? request.transaction!.objectStore(SESSION_STORE)
          : database.createObjectStore(SESSION_STORE, { keyPath: "id" });
        if (!store.indexNames.contains("updatedAt")) {
          store.createIndex("updatedAt", "updatedAt");
        }
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => reject(storageError("Unable to open chat history.", request.error));
      request.onblocked = () => reject(new ChatSessionStorageError("Chat history upgrade is blocked."));
    });
    return this.databasePromise;
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(storageError("Chat history operation failed.", request.error));
  });
}

function transactionCompleted(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(storageError("Chat history transaction failed.", transaction.error));
    transaction.onabort = () => reject(storageError("Chat history transaction was aborted.", transaction.error));
  });
}

function storageError(message: string, cause: DOMException | null): ChatSessionStorageError {
  return new ChatSessionStorageError(message, cause ? { cause } : undefined);
}
