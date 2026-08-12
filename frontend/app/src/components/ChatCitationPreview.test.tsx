import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ChatCitationPreview from "./ChatCitationPreview";

const mocks = vi.hoisted(() => ({
  loadDocument: vi.fn(),
}));

vi.mock("../api/documents", () => ({
  loadSourceDocument: mocks.loadDocument,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;
let createObjectUrl: ReturnType<typeof vi.fn>;
let revokeObjectUrl: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mocks.loadDocument.mockReset();
  createObjectUrl = vi.fn()
    .mockReturnValueOnce("about:blank?first")
    .mockReturnValueOnce("about:blank?second");
  revokeObjectUrl = vi.fn();
  const TestUrl = class extends URL {};
  Object.defineProperties(TestUrl, {
    createObjectURL: { value: createObjectUrl },
    revokeObjectURL: { value: revokeObjectUrl },
  });
  vi.stubGlobal("URL", TestUrl);
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  vi.unstubAllGlobals();
  root = undefined;
  container = undefined;
});

describe("ChatCitationPreview", () => {
  it("loads PDF pages through the app API and revokes replaced URLs", async () => {
    mocks.loadDocument.mockResolvedValue(new Blob(["pdf"]));
    render({
      id: "first",
      title: "First law",
      source: "laws/first.pdf",
      page: 4,
      kind: "law" as const,
    });
    await act(async () => Promise.resolve());

    expect(mocks.loadDocument).toHaveBeenCalledWith("laws/first.pdf");
    expect(container?.querySelector("iframe")?.getAttribute("src")).toBe(
      "about:blank?first#page=4",
    );

    render({
      id: "second",
      title: "Second law",
      source: "laws/second.pdf",
      page: 2,
      kind: "law" as const,
    });
    await act(async () => Promise.resolve());
    expect(revokeObjectUrl).toHaveBeenCalledWith("about:blank?first");
    expect(container?.querySelector("iframe")?.getAttribute("src")).toBe(
      "about:blank?second#page=2",
    );
  });

  it("uses context instead of requesting unavailable case files", () => {
    render({
      id: "case",
      title: "Case",
      source: "case.json",
      kind: "case" as const,
    });

    expect(mocks.loadDocument).not.toHaveBeenCalled();
    expect(container?.textContent).toContain("no file preview endpoint");
  });
});

function render(citation: Parameters<typeof ChatCitationPreview>[0]["citation"]): void {
  if (!container) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  act(() => root?.render(<ChatCitationPreview citation={citation} />));
}
