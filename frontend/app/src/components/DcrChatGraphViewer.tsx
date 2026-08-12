import { useEffect, useRef, useState } from "react";
import { moddleToDCR } from "dcr-engine";
import DCRModeler from "modeler";
import styled from "styled-components";

import type { ColoredRelations, MarkerNotation } from "../types";
import ReactiveModeler from "./ReactiveModeler";

const ViewerShell = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 20rem;
  overflow: hidden;

  & > #canvas {
    width: 100%;
    height: 100%;
  }
`;

export interface DcrChatGraphViewerProps {
  graphXml: string;
  coloredRelations?: ColoredRelations;
  markerNotation?: MarkerNotation;
  className?: string;
  onError?: (error: Error) => void;
}

/** Displays the backend-owned DCR state without allowing graph edits or execution. */
const DcrChatGraphViewer = ({
  graphXml,
  coloredRelations = true,
  markerNotation = "HM2011",
  className,
  onError,
}: DcrChatGraphViewerProps) => {
  const [modeler, setModeler] = useState<DCRModeler | null>(null);
  const importQueue = useRef<Promise<void>>(Promise.resolve());
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    if (!modeler || !graphXml.trim()) return;

    let active = true;
    const importGraph = async () => {
      if (!active) return;

      await modeler.importXML(graphXml);
      if (!active) return;

      const graph = moddleToDCR(modeler.getElementRegistry());
      modeler.setSimulating(true);
      modeler.updateRendering(graph, graph.initialVariableStore ?? {});
      modeler.getSelection()?.select([]);
    };
    const importTask = importQueue.current.then(importGraph, importGraph);
    importQueue.current = importTask.catch(() => undefined);
    void importTask.catch((error: unknown) => {
      if (!active) return;

      const importError = error instanceof Error ? error : new Error(String(error));
      if (onErrorRef.current) {
        onErrorRef.current(importError);
      } else {
        console.error("Unable to display the DCR graph.", importError);
      }
    });

    return () => {
      active = false;
    };
  }, [graphXml, modeler]);

  return (
    <ViewerShell
      className={className}
      role="region"
      aria-label="Current DCR graph"
    >
      <ReactiveModeler
        modeler={modeler}
        setModeler={setModeler}
        coloredRelations={coloredRelations}
        markerNotation={markerNotation}
        isSimulating={true}
        disableControls={true}
      />
    </ViewerShell>
  );
};

export default DcrChatGraphViewer;
