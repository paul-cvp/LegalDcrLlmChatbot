import { useEffect, useRef } from "react";
import { ChatApp } from "@dcr-js/chat";

import type { ChatLaunchConfig } from "../App";
import { ChatWorkspaceController, useChatWorkspace } from "../chat";
import type { ColoredRelations, MarkerNotation } from "../types";
import ChatCitationPreview from "./ChatCitationPreview";
import DcrChatGraphViewer from "./DcrChatGraphViewer";

export interface ChatStateProps {
  launch: ChatLaunchConfig;
  citizenInformation: string;
  markerNotation: MarkerNotation;
  coloredRelations: ColoredRelations;
  onBack: () => void;
  controller?: ChatWorkspaceController;
}

/** Connects the reusable presentation package to main-app services and state. */
export default function ChatState({
  launch,
  citizenInformation,
  markerNotation,
  coloredRelations,
  onBack,
  controller,
}: ChatStateProps) {
  const controllerRef = useRef(controller ?? new ChatWorkspaceController());
  const mountedRef = useRef(false);
  const chat = useChatWorkspace(
    launch,
    controllerRef.current,
    citizenInformation,
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      queueMicrotask(() => {
        if (!mountedRef.current) controllerRef.current.close();
      });
    };
  }, []);

  const graphPanel = chat.graphXml ? (
    <DcrChatGraphViewer
      graphXml={chat.graphXml}
      markerNotation={markerNotation}
      coloredRelations={coloredRelations}
    />
  ) : undefined;

  return (
    <ChatApp
      mode={chat.mode}
      title={chat.title}
      messages={chat.messages}
      settings={chat.settings}
      sessions={chat.sessions}
      activeSessionId={chat.activeSessionId}
      loading={chat.loading}
      error={chat.error}
      notice={chat.notice}
      inputDisabled={chat.inputDisabled}
      inputDisabledReason={chat.inputDisabledReason}
      expectedAnswerType={chat.expectedAnswerType}
      graphPanel={graphPanel}
      citationPanel={<ChatCitationPreview citation={chat.selectedCitation} />}
      hasCachedCitizenInformation={Boolean(citizenInformation.trim())}
      onSend={chat.send}
      onEditAnswer={chat.editAnswer}
      onClear={chat.clear}
      onSettingsChange={chat.updateSettings}
      onSelectSession={chat.selectSession}
      onDeleteSession={chat.deleteSession}
      onDeleteAllSessions={chat.deleteAllSessions}
      onSelectCandidate={(candidate) => chat.selectCandidate(candidate)}
      onFollowup={(question) => chat.send(question)}
      onCitationSelect={(citation) => chat.selectCitation(citation)}
      onStop={chat.stop}
      onBack={() => {
        chat.stop();
        onBack();
      }}
    />
  );
}
