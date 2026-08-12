import { useEffect, useState } from "react";
import type { ChatCitation } from "@dcr-js/chat";
import styled from "styled-components";

import { loadSourceDocument } from "../api/documents";

const Preview = styled.section`
  display: grid;
  gap: 0.75rem;
  margin-top: 1rem;

  iframe {
    width: 100%;
    min-height: 34rem;
    border: 1px solid #d7dce4;
    border-radius: 0.5rem;
    background: white;
  }

  p {
    margin: 0;
    color: #5c6678;
  }
`;

interface ChatCitationPreviewProps {
  citation?: ChatCitation;
}

/** Loads previewable laws through the main application's document API. */
export default function ChatCitationPreview({
  citation,
}: ChatCitationPreviewProps) {
  const [objectUrl, setObjectUrl] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    let createdUrl: string | undefined;
    setObjectUrl(undefined);
    setError(undefined);

    if (!citation || citation.kind !== "law") return;

    void loadSourceDocument(citation.source)
      .then((blob) => {
        if (!active) return;
        createdUrl = URL.createObjectURL(blob);
        setObjectUrl(createdUrl);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(
          reason instanceof Error ? reason.message : "Unable to open this citation.",
        );
      });

    return () => {
      active = false;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [citation]);

  if (!citation) return null;

  if (citation.kind !== "law") {
    return (
      <Preview>
        <p>
          This source has no file preview endpoint. The available evidence is
          shown above.
        </p>
      </Preview>
    );
  }

  const pageUrl = objectUrl
    ? `${objectUrl}#page=${Math.max(1, citation.page ?? 1)}`
    : undefined;

  return (
    <Preview>
      {pageUrl && (
        <>
          <a href={pageUrl} target="_blank" rel="noreferrer">
            Open {citation.title}
            {citation.page ? ` on page ${citation.page}` : ""}
          </a>
          <iframe title={`Citation: ${citation.title}`} src={pageUrl} />
        </>
      )}
      {!pageUrl && !error && <p>Loading citation…</p>}
      {error && <p role="alert">{error}</p>}
    </Preview>
  );
}
