import { useEffect, useState } from "react";
import styled from "styled-components";

import DCRModeler from "modeler";


const Backdrop = styled.div<{ $embedded: boolean }>`
  position: ${(props) => (props.$embedded ? "absolute" : "fixed")};
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.4);
`;

const Dialog = styled.div`
  width: fit-content;
  min-width: 360px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 32px);
  box-sizing: border-box;
  padding: 24px;
  border: 1px solid #ccc;
  border-radius: 8px;
  background: white;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.25);
  color: #333;
  font: 13px sans-serif;
  overflow: auto;
`;

const Title = styled.div`
  margin-bottom: 18px;
  font-size: 16px;
  font-weight: 700;
`;

const Label = styled.label`
  display: block;
  margin: 12px 0 5px;
  font-weight: 600;
`;

const Input = styled.input`
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  border: 1px solid #ccc;
  border-radius: 4px;
  font: 13px sans-serif;
`;

const Textarea = styled.textarea`
  width: min(590px, calc(100vw - 96px));
  min-height: 220px;
  box-sizing: border-box;
  padding: 8px 10px;
  border: 1px solid #ccc;
  border-radius: 4px;
  font: 13px sans-serif;
  max-width: calc(100vw - 96px);
  max-height: calc(100vh - 220px);
  resize: both;
`;

const Actions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 18px;
`;

const CancelButton = styled.button`
  padding: 6px 14px;
  border: 1px solid #ccc;
  border-radius: 4px;
  background: white;
  cursor: pointer;
`;

const SaveButton = styled.button`
  padding: 6px 14px;
  border: none;
  border-radius: 4px;
  background: #28a745;
  color: white;
  cursor: pointer;
  font-weight: 700;
`;

interface GraphMetadataModalProps {
  modeler: DCRModeler;
  onClose: () => void;
  embedded?: boolean;
}

const GraphMetadataModal = ({ modeler, onClose, embedded = false }: GraphMetadataModalProps) => {
  const root = modeler.get("canvas").getRootElement();
  const [title, setTitle] = useState(() => root.businessObject.title ?? "");
  const [description, setDescription] = useState(
    () => root.businessObject.description ?? "",
  );

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const save = () => {
    modeler.get("modeling").updateProperties(root, {
      title: title.trim() || undefined,
      description: description.trim() || undefined,
    });
    onClose();
  };

  return (
    <Backdrop
      $embedded={embedded}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <Dialog
        role="dialog"
        aria-modal="true"
        aria-labelledby="graph-metadata-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <Title id="graph-metadata-title">DCR Graph Metadata</Title>
        <Label htmlFor="graph-metadata-name">Title</Label>
        <Input
          id="graph-metadata-name"
          autoFocus
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <Label htmlFor="graph-metadata-description">Description</Label>
        <Textarea
          id="graph-metadata-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
        <Actions>
          <CancelButton type="button" onClick={onClose}>Cancel</CancelButton>
          <SaveButton type="button" onClick={save}>Save</SaveButton>
        </Actions>
      </Dialog>
    </Backdrop>
  );
};

export default GraphMetadataModal;
