import { afterEach, describe, expect, it } from "vitest";

import type { ChatSessionRecord } from "./models";
import { ChatSessionRepository, ChatSessionStorageError } from "./sessionRepository";

let repository: ChatSessionRepository | undefined;

afterEach(() => repository?.close());

describe("ChatSessionRepository", () => {
  it("reports browsers where IndexedDB is unavailable", async () => {
    repository = new ChatSessionRepository(undefined);

    await expect(repository.list()).rejects.toBeInstanceOf(ChatSessionStorageError);
  });

  it.skipIf(!globalThis.indexedDB)(
    "stores resumable sessions in newest-first order and deletes them",
    async () => {
    repository = new ChatSessionRepository(
      globalThis.indexedDB,
      `chat-session-test-${crypto.randomUUID()}`,
    );
    const older = session("old", 1);
    const newer = session("new", 2);

    await repository.put(older);
    await repository.save(newer);

    await expect(repository.get("old")).resolves.toEqual(older);
    await expect(repository.list()).resolves.toEqual([newer, older]);
    await repository.delete("old");
    await expect(repository.get("old")).resolves.toBeUndefined();
    },
  );
});

function session(id: string, updatedAt: number): ChatSessionRecord {
  return {
    id,
    mode: "dcr",
    title: id,
    updatedAt,
    selectedRole: "Citizen",
    robotAutoExecutionsPerActivity: 1,
    activityRepetitions: 0,
    graphXml: "<graph />",
    pendingActivityId: "activity",
    pendingActivityRole: "Citizen",
    messages: [],
    enrichment: {},
    candidates: [],
    candidateDescriptions: {},
  };
}
