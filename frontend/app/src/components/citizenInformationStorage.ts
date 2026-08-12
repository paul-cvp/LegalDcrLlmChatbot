import type { SourceDocument } from "../api/documents";

export const CITIZEN_INFORMATION_STORAGE_KEY = "lexplain.citizenInformation";

export interface CitizenInformationSession {
  text: string;
  sourceDocument: SourceDocument | null;
  snippetHtml: string;
}

export const EMPTY_CITIZEN_INFORMATION: CitizenInformationSession = {
  text: "",
  sourceDocument: null,
  snippetHtml: "",
};

export function loadCitizenInformation(): CitizenInformationSession {
  try {
    const stored = sessionStorage.getItem(CITIZEN_INFORMATION_STORAGE_KEY);
    if (!stored) return EMPTY_CITIZEN_INFORMATION;
    try {
      const value = JSON.parse(stored) as Partial<CitizenInformationSession>;
      return {
        text: typeof value.text === "string" ? value.text : "",
        sourceDocument: value.sourceDocument?.filename && value.sourceDocument.title
          ? value.sourceDocument
          : null,
        snippetHtml: typeof value.snippetHtml === "string" ? value.snippetHtml : "",
      };
    } catch {
      // Preserve data written by the previous string-only format.
      return { ...EMPTY_CITIZEN_INFORMATION, text: stored };
    }
  } catch {
    return EMPTY_CITIZEN_INFORMATION;
  }
}

export function storeCitizenInformation(value: CitizenInformationSession): void {
  try {
    sessionStorage.setItem(CITIZEN_INFORMATION_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // The React state remains usable when browser storage is unavailable.
  }
}
