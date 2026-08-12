import { beforeEach, describe, expect, it } from "vitest";

import {
  CITIZEN_INFORMATION_STORAGE_KEY,
  loadCitizenInformation,
  storeCitizenInformation,
} from "./citizenInformationStorage";


describe("Citizen Information session storage", () => {
  beforeEach(() => sessionStorage.clear());

  it("stores and restores edited information", () => {
    const stored = {
      text: "Edited fictional case",
      sourceDocument: { filename: "laws/example.pdf", title: "Example law" },
      snippetHtml: "<div><strong>Selected law</strong></div>",
    };
    storeCitizenInformation(stored);

    expect(JSON.parse(sessionStorage.getItem(CITIZEN_INFORMATION_STORAGE_KEY)!))
      .toEqual(stored);
    expect(loadCitizenInformation()).toEqual(stored);
  });

  it("migrates the previous string-only value", () => {
    sessionStorage.setItem(CITIZEN_INFORMATION_STORAGE_KEY, "Previous case");

    expect(loadCitizenInformation()).toEqual({
      text: "Previous case",
      sourceDocument: null,
      snippetHtml: "",
    });
  });
});
