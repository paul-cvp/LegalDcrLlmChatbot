import { useState } from "react";
import styled from "styled-components";
import { toast } from "react-toastify";
import convertDCRSolutionForStorage from "modeler/lib/DCRSolutionImport";
import { StateEnum, type StateProps } from "../App";
import FileUpload from "../utilComponents/FileUpload";
import {
  createDCRGraph,
  updateDCRGraph,
} from "../api/dcrGraphs";

const Container = styled.main`
  min-height: 100%;
  padding: 3rem clamp(1rem, 5vw, 5rem);
  box-sizing: border-box;
  background: #f5f7f8;
`;

const Toolbar = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  margin-bottom: 2rem;
  flex-wrap: wrap;
`;

const Button = styled.button<{ $danger?: boolean; $primary?: boolean }>`
  display: inline-flex;
  align-items: center;
  box-sizing: border-box;
  border: 1px solid
    ${({ $danger, $primary }) =>
      $danger ? "#b42318" : $primary ? "#175cd3" : "#667085"};
  border-radius: 0.5rem;
  padding: 0.65rem 1rem;
  color: ${({ $danger, $primary }) =>
    $danger ? "#b42318" : $primary ? "white" : "#344054"};
  background: ${({ $primary }) => ($primary ? "#175cd3" : "white")};
  font-family: inherit;
  font-size: inherit;
  line-height: normal;
  font-weight: 600;
  cursor: pointer;

  &:hover:not(:disabled):not([aria-disabled="true"]) {
    filter: brightness(0.94);
  }

  &:disabled,
  &[aria-disabled="true"] {
    cursor: not-allowed;
    opacity: 0.5;
  }
`;

const Panel = styled.section`
  max-width: 1200px;
  margin: auto;
  padding: 1.5rem;
  border-radius: 0.75rem;
  background: white;
  box-shadow: 0 1px 4px rgb(16 24 40 / 12%);
`;

const PanelTitle = styled.h2`
  margin-top: 0;
`;

const GraphRow = styled.div`
  display: grid;
  grid-template-columns: minmax(12rem, 1fr) auto;
  align-items: center;
  gap: 1rem;
  padding: 1rem 0;
  border-top: 1px solid #eaecf0;

  @media (max-width: 850px) {
    grid-template-columns: 1fr;
  }
`;

const GraphName = styled.strong`
  overflow-wrap: anywhere;
`;

const Actions = styled.div`
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
`;

const Status = styled.div<{ $error?: boolean }>`
  padding: 1.25rem;
  border-radius: 0.5rem;
  color: ${({ $error }) => ($error ? "#b42318" : "#475467")};
  background: ${({ $error }) => ($error ? "#fef3f2" : "#f9fafb")};
`;

const DialogBackdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: rgb(16 24 40 / 55%);
`;

const Dialog = styled.section`
  width: min(32rem, 100%);
  padding: 1.5rem;
  border-radius: 0.75rem;
  background: white;
  box-shadow: 0 1.25rem 3rem rgb(16 24 40 / 25%);
`;

const DialogTitle = styled.h2`
  margin: 0 0 1rem;
`;

const FieldLabel = styled.label`
  display: block;
  margin-bottom: 0.4rem;
  color: #344054;
  font-weight: 600;
`;

const NameInput = styled.input`
  width: 100%;
  box-sizing: border-box;
  padding: 0.65rem 0.75rem;
  border: 1px solid #98a2b3;
  border-radius: 0.5rem;
  font: inherit;
`;

const DialogMessage = styled.p<{ $error?: boolean; $warning?: boolean }>`
  min-height: 1.5rem;
  margin: 0.75rem 0;
  color: ${({ $error, $warning }) =>
    $error ? "#b42318" : $warning ? "#b54708" : "#475467"};
`;

const DialogActions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
`;

interface PendingImport {
  name: string;
  sourceFile: string;
  xml: string;
}

function HomeState({
  setState,
  openChat,
  savedGraphs,
  pickGraph,
  deleteGraph,
  graphsLoading,
  graphsError,
  reloadGraphs,
}: StateProps) {
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const openGraph = (name: string, destination: StateEnum) => {
    pickGraph(name);
    setState(destination);
  };

  const createGraph = () => {
    pickGraph(null);
    setState(StateEnum.Modeler);
  };

  const removeGraph = async (name: string) => {
    if (!window.confirm(`Delete “${name}”? This cannot be undone.`)) return;
    await deleteGraph(name);
  };

  const prepareImport = async (filename: string, contents: string) => {
    setImporting(true);
    setImportError(null);
    try {
      const xml = await convertDCRSolutionForStorage(contents);
      const name = filename.replace(/\.xml$/i, "");
      setPendingImport({ name, sourceFile: filename, xml });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to import the DCR Solutions XML.",
      );
    } finally {
      setImporting(false);
    }
  };

  const duplicate = pendingImport
    ? [...savedGraphs.values()].find(
        ({ name }) =>
          name.toLocaleLowerCase() ===
          pendingImport.name.trim().toLocaleLowerCase(),
      )
    : undefined;

  const persistImport = async () => {
    if (!pendingImport) return;
    const name = pendingImport.name.trim();
    if (!name) {
      setImportError("Enter a name for the imported graph.");
      return;
    }

    setImporting(true);
    setImportError(null);
    try {
      if (duplicate) {
        await updateDCRGraph(duplicate.name, pendingImport.xml);
      } else {
        await createDCRGraph(name, pendingImport.xml);
      }
      await reloadGraphs();
      setPendingImport(null);
      toast.success(duplicate ? "Graph replaced." : "Graph imported.");
    } catch (error) {
      setImportError(
        error instanceof Error ? error.message : "Unable to save the graph.",
      );
    } finally {
      setImporting(false);
    }
  };

  const unavailable = graphsLoading || graphsError !== null;

  return (
    <Container>
      <Toolbar>
        <Button onClick={() => openChat({ mode: "dcr-controller" })}>
          DCR Chat
        </Button>
        <Button onClick={() => openChat({ mode: "rag" })}>
          Pure RAG Chat
        </Button>
        <Button $primary disabled={unavailable} onClick={createGraph}>
          New DCR Graph
        </Button>
        <FileUpload
          accept=".xml,text/xml,application/xml"
          disabled={unavailable || importing}
          fileCallback={prepareImport}
        >
          <Button as="span" aria-disabled={unavailable || importing}>
            {importing && !pendingImport
              ? "Converting…"
              : "Import DCR Solutions XML Graph"}
          </Button>
        </FileUpload>
        <Button
          disabled={unavailable}
          onClick={() => {
            pickGraph(null);
            setState(StateEnum.FromText);
          }}
        >
          From Text
        </Button>
        <Button
          onClick={() => setState(StateEnum.CitizenInformation)}
        >
          Citizen Information
        </Button>
      </Toolbar>

      <Panel>
        <PanelTitle>Saved DCR Graphs</PanelTitle>
        {graphsLoading && <Status>Loading saved graphs…</Status>}
        {!graphsLoading && graphsError && (
          <Status $error>
            <p>Unable to load saved graphs: {graphsError}</p>
            <Button onClick={() => void reloadGraphs()}>Retry</Button>
          </Status>
        )}
        {!graphsLoading && !graphsError && savedGraphs.size === 0 && (
          <Status>No DCR graphs have been saved yet.</Status>
        )}
        {!graphsLoading &&
          !graphsError &&
          [...savedGraphs.values()].map(({ name, graph }) => (
            <GraphRow key={name}>
              <GraphName>{name}</GraphName>
              <Actions>
                <Button
                  onClick={() =>
                    openChat({ mode: "dcr", graphName: name, graphXml: graph })
                  }
                >
                  Chat
                </Button>
                <Button onClick={() => openGraph(name, StateEnum.Modeler)}>
                  Modeling
                </Button>
                <Button onClick={() => openGraph(name, StateEnum.Simulator)}>
                  Simulation
                </Button>
                {/* <Button onClick={() => openGraph(name, StateEnum.Conformance)}>
                  Conformance
                </Button>
                <Button
                  onClick={() =>
                    openGraph(name, StateEnum.EventLogGeneration)
                  }
                >
                  Log Generation
                </Button> */}
                <Button $danger onClick={() => void removeGraph(name)}>
                  Delete
                </Button>
              </Actions>
            </GraphRow>
          ))}
      </Panel>

      {pendingImport && (
        <DialogBackdrop
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !importing) {
              setPendingImport(null);
            }
          }}
        >
          <Dialog
            role="dialog"
            aria-modal="true"
            aria-labelledby="import-dialog-title"
          >
            <DialogTitle id="import-dialog-title">
              Import DCR Solution
            </DialogTitle>
            <p>Ready to import {pendingImport.sourceFile}.</p>
            <FieldLabel htmlFor="import-graph-name">Graph name</FieldLabel>
            <NameInput
              id="import-graph-name"
              autoFocus
              maxLength={120}
              value={pendingImport.name}
              disabled={importing}
              onChange={(event) => {
                setPendingImport({
                  ...pendingImport,
                  name: event.target.value,
                });
                setImportError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !importing) {
                  void persistImport();
                }
                if (event.key === "Escape" && !importing) {
                  setPendingImport(null);
                }
              }}
            />
            {duplicate && !importError && (
              <DialogMessage $warning>
                A graph named “{duplicate.name}” already exists. Replacing it
                cannot be undone; edit the name to save a separate graph.
              </DialogMessage>
            )}
            {!duplicate && !importError && (
              <DialogMessage>
                The converted graph will be added to Saved DCR Graphs.
              </DialogMessage>
            )}
            {importError && (
              <DialogMessage $error>{importError}</DialogMessage>
            )}
            <DialogActions>
              <Button
                disabled={importing}
                onClick={() => setPendingImport(null)}
              >
                Cancel
              </Button>
              <Button
                $danger={Boolean(duplicate)}
                $primary={!duplicate}
                disabled={importing || !pendingImport.name.trim()}
                onClick={() => void persistImport()}
              >
                {importing
                  ? "Saving…"
                  : duplicate
                    ? "Replace existing graph"
                    : "Save import"}
              </Button>
            </DialogActions>
          </Dialog>
        </DialogBackdrop>
      )}
    </Container>
  );
}

export default HomeState;
