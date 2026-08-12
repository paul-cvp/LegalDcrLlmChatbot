import { afterEach, describe, expect, it, vi } from "vitest";

import { generateCitizenInformation } from "./citizenInformation";


afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Citizen Information API", () => {
  it("posts selected law and language", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: "Fictional case" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(generateCitizenInformation({ text: "Law", language: "da" }))
      .resolves.toBe("Fictional case");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/documents-to-dcr/citizen-information",
      expect.objectContaining({ body: JSON.stringify({ text: "Law", language: "da" }) }),
    );
  });

  it("uses the backend error message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ detail: "Provider unavailable" }),
    }));

    await expect(generateCitizenInformation({ text: "Law", language: "source" }))
      .rejects.toThrow("Provider unavailable");
  });
});
