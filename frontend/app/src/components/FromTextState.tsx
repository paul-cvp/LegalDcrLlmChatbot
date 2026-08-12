import { useCallback, useEffect, useRef, useState } from "react";
import { Document as PdfDocument, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import { toast } from "react-toastify";
import {
  extractGraph,
  layoutGraph,
  type ExtractionConfig,
} from "dcr-engine";

import { StateEnum, type StateProps } from "../App";
import {
  listSourceDocuments,
  loadSourceDocument,
  type SourceDocument,
} from "../api/documents";
import { requestLLM, type ExtractionPhase } from "../api/llm";
import {
  applyActivityQuestions,
  generateActivityQuestions,
} from "../api/activityQuestions";
import {
  generateCitizenInformation,
  type CitizenLanguage,
} from "../api/citizenInformation";
import { createDefaultExtractionConfig } from "./modelExtractionDefaults";
import ModelerState from "./ModelerState";
import styles from "./FromTextState.module.css";
import type { CitizenInformationSession } from "./citizenInformationStorage";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

type PanelKey = "viewer" | "draft" | "modeler";

interface CapturedSnippet {
  html: string;
  text: string;
}

interface TextRun {
  text: string;
  left: number;
  right: number;
  top: number;
  height: number;
  bold: boolean;
  italic: boolean;
}

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[
        character
      ]!,
  );

const styledText = (run: TextRun, medianHeight: number) => {
  let text = escapeHtml(run.text);
  if (run.italic) text = `<em>${text}</em>`;
  if (run.bold || run.height > medianHeight * 1.18) text = `<strong>${text}</strong>`;
  return text;
};

/** Rebuild readable rich text from the positioned glyph runs in PDF.js' text layer. */
function capturePdfSelection(viewer: HTMLElement): CapturedSnippet | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!viewer.contains(range.commonAncestorContainer)) return null;

  const runs: TextRun[] = [];
  const walker = document.createTreeWalker(viewer, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (!node.data || !range.intersectsNode(node)) continue;
    const start = node === range.startContainer ? range.startOffset : 0;
    const end = node === range.endContainer ? range.endOffset : node.length;
    const text = node.data.slice(start, end);
    if (!text) continue;

    const selectedRange = document.createRange();
    selectedRange.setStart(node, start);
    selectedRange.setEnd(node, end);
    const rect = selectedRange.getBoundingClientRect();
    if (!rect.width && !rect.height) continue;
    const element = node.parentElement;
    const computed = element ? window.getComputedStyle(element) : null;
    const fontName = `${computed?.fontFamily ?? ""} ${element?.getAttribute("style") ?? ""}`;
    runs.push({
      text,
      left: rect.left,
      right: rect.right,
      top: rect.top,
      height: Math.max(rect.height, 1),
      bold: /bold|black|heavy|semibold|demi/i.test(fontName) || Number(computed?.fontWeight) >= 600,
      italic: /italic|oblique/i.test(fontName) || computed?.fontStyle === "italic",
    });
  }
  if (runs.length === 0) return null;

  const heights = runs.map((run) => run.height).sort((left, right) => left - right);
  const medianHeight = heights[Math.floor(heights.length / 2)];
  const minLeft = Math.min(...runs.map((run) => run.left));
  const lines: TextRun[][] = [];
  for (const run of runs) {
    const line = lines.at(-1);
    if (!line || Math.abs(line[0].top - run.top) > Math.max(line[0].height, run.height) * 0.55) {
      lines.push([run]);
    } else {
      line.push(run);
    }
  }

  let previousBottom: number | null = null;
  const html = lines
    .map((line) => {
      const lineTop = Math.min(...line.map((run) => run.top));
      const lineHeight = Math.max(...line.map((run) => run.height));
      const blankLine = previousBottom !== null && lineTop - previousBottom > lineHeight * 1.45;
      previousBottom = lineTop + lineHeight;
      let previousRight: number | null = null;
      const contents = line
        .map((run) => {
          const gap = previousRight === null ? 0 : run.left - previousRight;
          previousRight = run.right;
          const separator = gap > run.height * 0.18 ? " " : "";
          return separator + styledText(run, medianHeight);
        })
        .join("");
      const indent = Math.min(80, Math.max(0, Math.round(Math.min(...line.map((run) => run.left)) - minLeft)));
      return `${blankLine ? "<div><br></div>" : ""}<div style="margin-left:${indent}px">${contents}</div>`;
    })
    .join("");

  const scratch = document.createElement("div");
  scratch.innerHTML = html;
  const text = scratch.innerText.trim();
  return text ? { html, text } : null;
}

interface FromTextStateProps extends StateProps {
  mode?: "dcr" | "citizen";
  citizenInformation?: CitizenInformationSession;
  updateCitizenInformation?: (changes: Partial<CitizenInformationSession>) => void;
}

export const countWords = (value: string) =>
  value.trim() ? value.trim().split(/\s+/).length : 0;

function FromTextState(props: FromTextStateProps) {
  const isCitizenMode = props.mode === "citizen";
  const [documents, setDocuments] = useState<SourceDocument[]>([]);
  const [selectedDocument, setSelectedDocument] = useState<SourceDocument | null>(null);
  const [documentBlob, setDocumentBlob] = useState<Blob | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [viewerWidth, setViewerWidth] = useState(720);
  const [pendingSnippet, setPendingSnippet] = useState<CapturedSnippet | null>(null);
  const [config, setConfig] = useState<ExtractionConfig>(createDefaultExtractionConfig);
  const [descriptionDraft, setDescriptionDraft] = useState(() => ({
    mentionDescription: config.mentionDescription,
    relationDescription: config.relationDescription,
    dataDescription: config.dataDescription,
  }));
  const [draftHasText, setDraftHasText] = useState(false);
  const [generatedGraph, setGeneratedGraph] = useState<{ name: string; graph: string } | null>(null);
  const [isLoadingDocuments, setIsLoadingDocuments] = useState(true);
  const [isLoadingPdf, setIsLoadingPdf] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isGeneratingCitizen, setIsGeneratingCitizen] = useState(false);
  const [citizenLanguage, setCitizenLanguage] = useState<CitizenLanguage>("source");
  const [extractionStatus, setExtractionStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<PanelKey, boolean>>({
    viewer: true,
    draft: true,
    modeler: false,
  });
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const pdfAreaRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const draftRangeRef = useRef<Range | null>(null);
  const restoredCitizenDraftRef = useRef(false);
  const restoredCitizenSourceRef = useRef(false);
  const descriptionsChanged =
    descriptionDraft.mentionDescription !== config.mentionDescription ||
    descriptionDraft.relationDescription !== config.relationDescription ||
    descriptionDraft.dataDescription !== config.dataDescription;

  const saveDescriptions = () => {
    setConfig((current) => ({ ...current, ...descriptionDraft }));
    toast.success("Descriptions saved.");
  };

  const refreshDocuments = useCallback(async () => {
    setIsLoadingDocuments(true);
    try {
      setDocuments(await listSourceDocuments());
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to list PDF documents.");
    } finally {
      setIsLoadingDocuments(false);
    }
  }, []);

  useEffect(() => {
    void refreshDocuments();
  }, [refreshDocuments]);

  useEffect(() => {
    if (!isCitizenMode || restoredCitizenDraftRef.current || !editorRef.current) return;
    editorRef.current.innerHTML = props.citizenInformation?.snippetHtml ?? "";
    setDraftHasText(Boolean(editorRef.current.innerText.trim()));
    restoredCitizenDraftRef.current = true;
  }, [isCitizenMode, props.citizenInformation?.snippetHtml]);

  useEffect(() => {
    if (!expanded.viewer || !pdfAreaRef.current) return;
    const updateWidth = () => {
      setViewerWidth(Math.max(320, Math.min(900, pdfAreaRef.current!.clientWidth - 40)));
    };
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(pdfAreaRef.current);
    return () => observer.disconnect();
  }, [expanded.viewer]);

  const openDocument = async (source: SourceDocument) => {
    setIsLoadingPdf(true);
    setPendingSnippet(null);
    try {
      setDocumentBlob(await loadSourceDocument(source.filename));
      setSelectedDocument(source);
      setPageCount(0);
      setExpanded((current) => ({ ...current, viewer: true }));
      if (isCitizenMode) props.updateCitizenInformation?.({ sourceDocument: source });
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to open PDF document.");
    } finally {
      setIsLoadingPdf(false);
    }
  };

  useEffect(() => {
    if (!isCitizenMode || isLoadingDocuments || restoredCitizenSourceRef.current) return;
    restoredCitizenSourceRef.current = true;
    const storedSource = props.citizenInformation?.sourceDocument;
    if (!storedSource) return;
    const source = documents.find(({ filename }) => filename === storedSource.filename);
    if (source) void openDocument(source);
    else setError(`The stored source PDF "${storedSource.title}" is no longer available.`);
  }, [documents, isCitizenMode, isLoadingDocuments, props.citizenInformation?.sourceDocument]);

  const rememberDraftCursor = () => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !editorRef.current) return;
    const range = selection.getRangeAt(0);
    if (editorRef.current.contains(range.commonAncestorContainer)) {
      draftRangeRef.current = range.cloneRange();
    }
  };

  const updateDraftState = () => {
    setDraftHasText(Boolean(editorRef.current?.innerText.trim()));
    if (isCitizenMode) {
      props.updateCitizenInformation?.({ snippetHtml: editorRef.current?.innerHTML ?? "" });
    }
    rememberDraftCursor();
  };

  const addSnippet = () => {
    if (!pendingSnippet || !editorRef.current) return;
    const editor = editorRef.current;
    const range = draftRangeRef.current;
    const insertion = document.createRange();
    if (range && editor.contains(range.commonAncestorContainer)) {
      insertion.setStart(range.startContainer, range.startOffset);
    } else {
      insertion.selectNodeContents(editor);
      insertion.collapse(false);
      if (editor.innerText.trim()) insertion.insertNode(document.createElement("br"));
      insertion.selectNodeContents(editor);
      insertion.collapse(false);
    }

    const template = document.createElement("template");
    template.innerHTML = pendingSnippet.html;
    const lastNode = template.content.lastChild;
    insertion.insertNode(template.content);
    if (lastNode) {
      insertion.setStartAfter(lastNode);
      insertion.collapse(true);
      draftRangeRef.current = insertion.cloneRange();
    }
    setPendingSnippet(null);
    setDraftHasText(true);
    if (isCitizenMode) {
      props.updateCitizenInformation?.({ snippetHtml: editor.innerHTML });
    }
    setExpanded((current) => ({ ...current, draft: true }));
  };

  const extract = async () => {
    const text = editorRef.current?.innerText.trim() ?? "";
    if (!text) {
      setError("Add or enter text in Custom before extracting a graph.");
      setExpanded((current) => ({ ...current, draft: true }));
      return;
    }
    setIsExtracting(true);
    setExtractionStatus("Step 1 of 5: Extracting Entities…");
    setError(null);
    try {
      const extractionConfig = { ...config, text };
      const phases: Array<{ phase: ExtractionPhase; status: string }> = [
        { phase: "entities", status: "Step 1 of 5: Extracting Entities…" },
        { phase: "relations", status: "Step 2 of 5: Extracting Relations…" },
        { phase: "data_time", status: "Step 3 of 5: Extracting Data and Time…" },
      ];
      let phaseIndex = 0;
      const result = await extractGraph(extractionConfig, (input) => {
        const currentPhase = phases[phaseIndex++]!;
        setExtractionStatus(currentPhase.status);
        return requestLLM(input, currentPhase.phase);
      });
      // The source law remains available in the generated graph metadata.
      result.graph.description = text;
      const graphName = result.graph.title ?? "Generated Process";
      setExtractionStatus("Step 4 of 5: Laying out the process…");
      const graph = await layoutGraph(result.graph);
      setExtractionStatus("Step 5 of 5: Generating activity questions…");
      const questions = await generateActivityQuestions(graph);
      const finalizedGraph = applyActivityQuestions(graph, questions);
      props.pickGraph(null);
      setGeneratedGraph({ name: graphName, graph: finalizedGraph });
      setExpanded({ viewer: false, draft: true, modeler: true });
    } catch (extractionError) {
      const message = extractionError instanceof Error ? extractionError.message : "Model extraction failed.";
      setError(message);
      toast.error(message);
    } finally {
      setIsExtracting(false);
      setExtractionStatus(null);
    }
  };

  const generateCitizen = async () => {
    const text = editorRef.current?.innerText.trim() ?? "";
    if (!text) {
      setError("Add or enter law text in Custom before generating Citizen Information.");
      return;
    }
    if (props.citizenInformation?.text && !window.confirm(
      "Replace the existing Citizen Information?",
    )) return;

    setIsGeneratingCitizen(true);
    setError(null);
    try {
      const generated = await generateCitizenInformation({
        text,
        language: citizenLanguage,
      });
      props.updateCitizenInformation?.({ text: generated });
      toast.success("Citizen Information generated and saved.");
    } catch (generationError) {
      const message = generationError instanceof Error
        ? generationError.message
        : "Citizen Information generation failed.";
      setError(message);
      toast.error(message);
    } finally {
      setIsGeneratingCitizen(false);
    }
  };

  const panelClass = (panel: PanelKey) =>
    `${styles.panel} ${styles[`${panel}Panel`]} ${expanded[panel] ? styles.expanded : styles.collapsed}`;

  return (
    <main className={styles.page}>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <div>
            <h1 className={styles.sidebarTitle}>Source PDFs</h1>
            <p>{isCitizenMode
              ? "Select a law and capture excerpts for a fictional citizen case."
              : "Select a law, capture excerpts, and extract a DCR graph."}</p>
          </div>
          <button type="button" onClick={() => props.setState(StateEnum.Home)}>Home</button>
        </div>
        <button type="button" className={styles.refreshButton} onClick={() => void refreshDocuments()}>
          Refresh documents
        </button>
        <div className={styles.documentList}>
          {isLoadingDocuments ? (
            <div className={styles.empty}>Loading documents…</div>
          ) : documents.length === 0 ? (
            <div className={styles.empty}>No PDF documents found.</div>
          ) : (
            documents.map((source) => (
              <button
                type="button"
                key={source.filename}
                className={`${styles.documentButton} ${selectedDocument?.filename === source.filename ? styles.selectedDocument : ""}`}
                onClick={() => void openDocument(source)}
              >
                <strong>{source.title}</strong>
                <span>{source.filename}</span>
              </button>
            ))
          )}
        </div>
      </aside>

      <section className={styles.workspace}>
        <section className={panelClass("viewer")}>
          <header className={styles.panelHeader}>
            <div className={styles.panelHeading}>
              <h2>PDF Viewer</h2>
              {expanded.viewer && <p>{selectedDocument?.title ?? "Select a PDF from the list"}</p>}
            </div>
            <button type="button" onClick={() => setExpanded((current) => ({ ...current, viewer: !current.viewer }))}>
              {expanded.viewer ? "Minimize" : "Expand"}
            </button>
          </header>
          {expanded.viewer ? (
            <div className={styles.panelBody}>
              {isLoadingPdf ? (
                <div className={styles.empty}>Opening PDF…</div>
              ) : !documentBlob ? (
                <div className={styles.empty}>Select a source PDF to view and highlight its text.</div>
              ) : (
                <div ref={pdfAreaRef} className={styles.pdfArea}>
                  <div
                    ref={viewerRef}
                    className={styles.pdfPages}
                    onMouseUp={() => {
                      if (viewerRef.current) setPendingSnippet(capturePdfSelection(viewerRef.current));
                    }}
                  >
                    <PdfDocument
                      file={documentBlob}
                      loading={<div className={styles.empty}>Rendering PDF…</div>}
                      onLoadSuccess={({ numPages }) => setPageCount(numPages)}
                      onLoadError={(loadError) => setError(loadError.message)}
                    >
                      {Array.from({ length: pageCount }, (_, index) => (
                        <Page
                          key={index + 1}
                          pageNumber={index + 1}
                          width={viewerWidth}
                          renderAnnotationLayer={false}
                        />
                      ))}
                    </PdfDocument>
                  </div>
                </div>
              )}
            </div>
          ) : <div className={styles.rail}>PDF Viewer</div>}
        </section>

        <section className={panelClass("draft")}>
          <header className={styles.panelHeader}>
            <div className={styles.panelHeading}>
              <h2>Draft</h2>
              {expanded.draft && <p>{isCitizenMode
                ? "Review the selected law, then generate and edit Citizen Information."
                : "Review the selection, edit Custom, then extract the graph."}</p>}
            </div>
            <button type="button" onClick={() => setExpanded((current) => ({ ...current, draft: !current.draft }))}>
              {expanded.draft ? "Minimize" : "Expand"}
            </button>
          </header>
          {expanded.draft ? (
            <div className={`${styles.panelBody} ${styles.draftBody}`}>
              {pendingSnippet && (
                <section className={styles.selectionCard}>
                  <div>
                    <strong>Pending selection</strong>
                    <span>{selectedDocument?.title}</span>
                  </div>
                  <div className={styles.selectionPreview} dangerouslySetInnerHTML={{ __html: pendingSnippet.html }} />
                  <div className={styles.actions}>
                    <button type="button" onClick={() => setPendingSnippet(null)}>Dismiss</button>
                    <button type="button" className={styles.primaryButton} onClick={addSnippet}>Add to Custom</button>
                  </div>
                </section>
              )}

              <label className={styles.fieldLabel}>Custom</label>
              <div
                ref={editorRef}
                className={styles.richEditor}
                contentEditable
                role="textbox"
                aria-multiline="true"
                data-placeholder="Selected snippets will be inserted here. You can also type and edit freely."
                onInput={updateDraftState}
                onKeyUp={rememberDraftCursor}
                onMouseUp={rememberDraftCursor}
                onPaste={(event) => {
                  event.preventDefault();
                  document.execCommand("insertText", false, event.clipboardData.getData("text/plain"));
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  document.execCommand("insertText", false, event.dataTransfer.getData("text/plain"));
                }}
                suppressContentEditableWarning
              />

              {isCitizenMode ? (
                <>
                  <div className={styles.citizenControls}>
                    <label htmlFor="citizen-language">Output language</label>
                    <select
                      id="citizen-language"
                      value={citizenLanguage}
                      onChange={(event) => setCitizenLanguage(event.target.value as CitizenLanguage)}
                    >
                      <option value="source">Language of the snippets</option>
                      <option value="da">Danish</option>
                      <option value="en">English</option>
                      <option value="no">Norwegian</option>
                    </select>
                    <button
                      type="button"
                      className={styles.primaryButton}
                      disabled={!draftHasText || isGeneratingCitizen}
                      onClick={() => void generateCitizen()}
                    >
                      {isGeneratingCitizen ? "Generating…" : "Generate Citizen Information"}
                    </button>
                  </div>
                  {isGeneratingCitizen && (
                    <div className={styles.extractionProgress} role="status" aria-live="polite">
                      <span className={styles.progressSpinner} aria-hidden="true" />
                      Generating Citizen Information…
                    </div>
                  )}
                  <div className={styles.citizenHeading}>
                    <h3>Citizen Information</h3>
                    <span>Saved in this browser session</span>
                  </div>
                  <textarea
                    className={styles.citizenOutput}
                    aria-label="Citizen Information"
                    placeholder="Generated Citizen Information will appear here and can be edited."
                    value={props.citizenInformation?.text ?? ""}
                    onChange={(event) => props.updateCitizenInformation?.({ text: event.target.value })}
                  />
                  <div className={styles.wordCount}>
                    {countWords(props.citizenInformation?.text ?? "")} words
                  </div>
                </>
              ) : (
                <>
                  <div className={styles.descriptionHeader}>
                    <h3 className={styles.descriptionHeading}>Descriptions</h3>
                    <button type="button" disabled={!descriptionsChanged} onClick={saveDescriptions}>
                      Save Descriptions
                    </button>
                  </div>
                  <label className={styles.fieldLabel}>Entities</label>
                  <textarea value={descriptionDraft.mentionDescription} onChange={(event) => setDescriptionDraft({ ...descriptionDraft, mentionDescription: event.target.value })} />
                  <label className={styles.fieldLabel}>Relations</label>
                  <textarea value={descriptionDraft.relationDescription} onChange={(event) => setDescriptionDraft({ ...descriptionDraft, relationDescription: event.target.value })} />
                  <label className={styles.fieldLabel}>Data and Time</label>
                  <textarea value={descriptionDraft.dataDescription} onChange={(event) => setDescriptionDraft({ ...descriptionDraft, dataDescription: event.target.value })} />
                  {extractionStatus && (
                    <div className={styles.extractionProgress} role="status" aria-live="polite">
                      <span className={styles.progressSpinner} aria-hidden="true" />
                      {extractionStatus}
                    </div>
                  )}
                  <button type="button" className={styles.extractButton} disabled={!draftHasText || isExtracting} onClick={() => void extract()}>
                    {extractionStatus ?? "Extract"}
                  </button>
                </>
              )}
            </div>
          ) : <div className={styles.rail}>Draft</div>}
        </section>

        {!isCitizenMode && <section className={panelClass("modeler")}>
          <header className={styles.panelHeader}>
            <div className={styles.panelHeading}>
              <h2>Modeler</h2>
              {expanded.modeler && <p>{generatedGraph?.name ?? "Extract text to create a graph"}</p>}
            </div>
            <button type="button" onClick={() => setExpanded((current) => ({ ...current, modeler: !current.modeler }))}>
              {expanded.modeler ? "Minimize" : "Expand"}
            </button>
          </header>
          {expanded.modeler ? (
            <div className={`${styles.panelBody} ${styles.modelerBody}`}>
              {generatedGraph ? (
                <ModelerState {...props} embedded initialGraph={generatedGraph} />
              ) : (
                <div className={styles.empty}>The generated DCR graph will open here as an editable draft.</div>
              )}
            </div>
          ) : <div className={styles.rail}>Modeler</div>}
        </section>}
      </section>
      {error && <div className={styles.error}>{error}</div>}
    </main>
  );
}

export default FromTextState;
