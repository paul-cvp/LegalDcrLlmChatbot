import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import DcrChatGraphViewer from "./DcrChatGraphViewer";

const mocks = vi.hoisted(() => {
  const graph = { initialVariableStore: { amount: 1 } };
  const modeler = {
    getElementRegistry: vi.fn(() => "registry"),
    getSelection: vi.fn(() => ({ select: vi.fn() })),
    importXML: vi.fn(),
    setSimulating: vi.fn(),
    updateRendering: vi.fn(),
  };

  return {
    graph,
    modeler,
    moddleToDCR: vi.fn(() => graph),
    reactiveProps: vi.fn(),
  };
});

vi.mock("dcr-engine", () => ({
  moddleToDCR: mocks.moddleToDCR,
}));
vi.mock("./ReactiveModeler", () => ({
  default: (props: {
    setModeler: (modeler: typeof mocks.modeler | null) => void;
  }) => {
    mocks.reactiveProps(props);
    useEffect(() => {
      props.setModeler(mocks.modeler);
      return () => props.setModeler(null);
    }, [props.setModeler]);
    return <div data-testid="modeler-canvas" />;
  },
}));

describe("DCR chat graph viewer", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.modeler.importXML.mockResolvedValue(undefined);
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = "";
  });

  it("renders each backend graph in read-only simulation mode", async () => {
    await act(async () => {
      root.render(<DcrChatGraphViewer graphXml="<graph id='first' />" />);
    });

    expect(mocks.modeler.importXML).toHaveBeenCalledWith("<graph id='first' />");
    expect(mocks.moddleToDCR).toHaveBeenCalledWith("registry");
    expect(mocks.modeler.setSimulating).toHaveBeenCalledWith(true);
    expect(mocks.modeler.updateRendering).toHaveBeenCalledWith(
      mocks.graph,
      mocks.graph.initialVariableStore,
    );

    const reactiveProps = mocks.reactiveProps.mock.calls.at(-1)?.[0];
    expect(reactiveProps).toMatchObject({
      disableControls: true,
      isSimulating: true,
    });
    expect(reactiveProps.onClickElement).toBeUndefined();

    await act(async () => {
      root.render(<DcrChatGraphViewer graphXml="<graph id='updated' />" />);
    });

    expect(mocks.modeler.importXML).toHaveBeenLastCalledWith("<graph id='updated' />");
  });
});
