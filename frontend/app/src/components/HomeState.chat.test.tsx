import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { StateProps } from "../App";
import HomeState from "./HomeState";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

describe("HomeState chat launchers", () => {
  it("launches controller, RAG, and graph-specific chats", () => {
    const openChat = vi.fn();
    const graphXml = "<dcr:definitions />";
    const props = {
      openChat,
      setState: vi.fn(),
      savedGraphs: new Map([
        ["Support process", { name: "Support process", graph: graphXml }],
      ]),
      pickGraph: vi.fn(),
      deleteGraph: vi.fn(),
      graphsLoading: false,
      graphsError: null,
      reloadGraphs: vi.fn(),
    } as unknown as StateProps;

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root?.render(<HomeState {...props} />));

    clickButton("DCR Chat");
    clickButton("Pure RAG Chat");
    clickButton("Chat");

    expect(openChat.mock.calls).toEqual([
      [{ mode: "dcr-controller" }],
      [{ mode: "rag" }],
      [{ mode: "dcr", graphName: "Support process", graphXml }],
    ]);
  });
});

function clickButton(label: string): void {
  const button = [...container!.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  expect(button, `Button ${label} should exist`).toBeTruthy();
  act(() => button?.click());
}
