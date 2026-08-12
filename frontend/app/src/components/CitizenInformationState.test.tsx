import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StateEnum, type StateProps } from "../App";
import CitizenInformationState from "./CitizenInformationState";
import { countWords } from "./FromTextState";
import HomeState from "./HomeState";
import ModelerState from "./ModelerState";


const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  listDocuments: vi.fn(),
  loadDocument: vi.fn(),
  importXML: vi.fn(),
  saveXML: vi.fn(),
  listToolCalls: vi.fn(),
}));

vi.mock("react-pdf", () => ({
  pdfjs: { GlobalWorkerOptions: {} },
  Document: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Page: () => <div />,
}));
vi.mock("../api/documents", () => ({
  listSourceDocuments: mocks.listDocuments,
  loadSourceDocument: mocks.loadDocument,
}));
vi.mock("../api/citizenInformation", () => ({
  generateCitizenInformation: mocks.generate,
}));
vi.mock("../api/toolCalls", () => ({
  listToolCalls: mocks.listToolCalls,
}));
vi.mock("../utilComponents/useBPMN", () => ({
  useBPMN: () => ({ convertBpmnToDcr: vi.fn(), loading: false }),
}));
vi.mock("./ReactiveModeler", () => ({
  default: ({ setModeler }: { setModeler: (modeler: unknown) => void }) => {
    useEffect(() => {
      setModeler({
        importXML: mocks.importXML,
        saveXML: mocks.saveXML,
        validateGuards: () => [],
      });
      return () => setModeler(null);
    }, [setModeler]);
    return <div data-testid="modeler-canvas" />;
  },
}));

const stateProps = {
  setState: vi.fn(),
  openChat: vi.fn(),
  savedGraphs: new Map(),
  setSavedGraphs: vi.fn(),
  savedLogs: new Map(),
  setSavedLogs: vi.fn(),
  currentGraph: null,
  draftGraph: null,
  openDraftGraph: vi.fn(),
  setCurrentGraph: vi.fn(),
  currentLog: null,
  setCurrentLog: vi.fn(),
  saveGraph: vi.fn().mockResolvedValue(true),
  deleteGraph: vi.fn().mockResolvedValue(true),
  graphsLoading: false,
  graphsError: null,
  reloadGraphs: vi.fn().mockResolvedValue(undefined),
  saveLog: vi.fn(),
  pickGraph: vi.fn(),
  pickLog: vi.fn(),
  markerNotation: "HM2011",
  changeMarkerNotation: vi.fn(),
  coloredRelations: true,
  changeColoredRelations: vi.fn(),
} as StateProps;

describe("Citizen Information page", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.generate.mockReset();
    mocks.loadDocument.mockReset();
    mocks.importXML.mockReset().mockResolvedValue({ warnings: [] });
    mocks.saveXML.mockReset().mockResolvedValue({ xml: "<dcr:definitions />" });
    mocks.listToolCalls.mockReset().mockResolvedValue([]);
    mocks.listDocuments.mockResolvedValue([]);
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("shows the shared PDF workspace and editable session value", async () => {
    const updateCitizenInformation = vi.fn();
    await act(async () => {
      root.render(
        <CitizenInformationState
          {...stateProps}
          citizenInformation={{
            text: "Existing fictional case",
            sourceDocument: null,
            snippetHtml: "",
          }}
          updateCitizenInformation={updateCitizenInformation}
        />,
      );
    });

    expect(container.textContent).toContain("Source PDFs");
    expect(container.textContent).toContain("PDF Viewer");
    expect(container.textContent).toContain("Draft");
    expect(container.textContent).not.toContain("Modeler");
    const output = container.querySelector(
      'textarea[aria-label="Citizen Information"]',
    ) as HTMLTextAreaElement;
    expect(output.value).toBe("Existing fictional case");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!
        .set!.call(output, "Edited case");
      output.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(updateCitizenInformation).toHaveBeenCalledWith({ text: "Edited case" });
  });

  it("opens the page from the dashboard button", async () => {
    await act(async () => root.render(<HomeState {...stateProps} />));
    const button = Array.from(container.querySelectorAll("button"))
      .find((candidate) => candidate.textContent === "Citizen Information")!;

    await act(async () => button.click());

    expect(stateProps.setState).toHaveBeenCalledWith(StateEnum.CitizenInformation);
  });

  it("places the Simulation switch after metadata and opens the same graph", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => "" }));
    await act(async () => root.render(<ModelerState {...stateProps} />));
    const metadata = container.querySelector('[data-testid="graph-metadata-icon"]')!;
    const simulation = container.querySelector('[data-testid="simulation-mode-icon"]') as SVGElement;
    expect(metadata.nextElementSibling).toBe(simulation);

    await act(async () => simulation.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(mocks.saveXML).toHaveBeenCalledWith({ format: true });
    expect(stateProps.openDraftGraph).toHaveBeenCalledWith(
      "DCR-JS Graph",
      "<dcr:definitions />",
      StateEnum.Simulator,
      true,
    );
  });

  it("counts words without limiting manual edits", () => {
    expect(countWords("  one\n two   three ")).toBe(3);
    expect(countWords("")).toBe(0);
  });

  it("generates with the selected language after law text is added", async () => {
    const updateCitizenInformation = vi.fn();
    mocks.generate.mockResolvedValue("Generated fictional case");
    await act(async () => {
      root.render(
        <CitizenInformationState
          {...stateProps}
          citizenInformation={{ text: "", sourceDocument: null, snippetHtml: "" }}
          updateCitizenInformation={updateCitizenInformation}
        />,
      );
    });
    const editor = container.querySelector('[contenteditable="true"]') as HTMLElement;
    const language = container.querySelector("#citizen-language") as HTMLSelectElement;
    await act(async () => {
      editor.innerText = "Selected law";
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      language.value = "no";
      language.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const generate = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Generate Citizen Information")!;

    await act(async () => generate.click());

    expect(mocks.generate).toHaveBeenCalledWith({
      text: "Selected law",
      language: "no",
    });
    expect(updateCitizenInformation).toHaveBeenCalledWith({ text: "Generated fictional case" });
  });

  it("preserves existing information when replacement is cancelled", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    await act(async () => {
      root.render(
        <CitizenInformationState
          {...stateProps}
          citizenInformation={{ text: "Keep this case", sourceDocument: null, snippetHtml: "" }}
          updateCitizenInformation={vi.fn()}
        />,
      );
    });
    const editor = container.querySelector('[contenteditable="true"]') as HTMLElement;
    await act(async () => {
      editor.innerText = "Selected law";
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const generate = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Generate Citizen Information")!;

    await act(async () => generate.click());

    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("restores the selected PDF and rich law snippet", async () => {
    const source = { filename: "laws/example.pdf", title: "Example law" };
    mocks.listDocuments.mockResolvedValue([source]);
    mocks.loadDocument.mockResolvedValue(new Blob(["pdf"]));

    await act(async () => {
      root.render(
        <CitizenInformationState
          {...stateProps}
          citizenInformation={{
            text: "Stored case",
            sourceDocument: source,
            snippetHtml: "<div><strong>Stored law snippet</strong></div>",
          }}
          updateCitizenInformation={vi.fn()}
        />,
      );
    });

    expect(mocks.loadDocument).toHaveBeenCalledWith("laws/example.pdf");
    const editor = container.querySelector('[contenteditable="true"]') as HTMLElement;
    expect(editor.innerHTML).toContain("<strong>Stored law snippet</strong>");
    expect(container.textContent).toContain("Example law");
  });

  it("stores the selected PDF and edited rich snippet", async () => {
    const source = { filename: "laws/new.pdf", title: "New law" };
    const updateCitizenInformation = vi.fn();
    mocks.listDocuments.mockResolvedValue([source]);
    mocks.loadDocument.mockResolvedValue(new Blob(["pdf"]));
    await act(async () => {
      root.render(
        <CitizenInformationState
          {...stateProps}
          citizenInformation={{ text: "", sourceDocument: null, snippetHtml: "" }}
          updateCitizenInformation={updateCitizenInformation}
        />,
      );
    });
    const sourceButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("New law"))!;
    await act(async () => sourceButton.click());
    expect(updateCitizenInformation).toHaveBeenCalledWith({ sourceDocument: source });

    const editor = container.querySelector('[contenteditable="true"]') as HTMLElement;
    await act(async () => {
      editor.innerHTML = "<div><em>Edited law snippet</em></div>";
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(updateCitizenInformation).toHaveBeenCalledWith({
      snippetHtml: "<div><em>Edited law snippet</em></div>",
    });
  });
});
