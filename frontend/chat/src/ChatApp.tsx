import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type {
  ChatAppProps,
  ChatCitation,
  ChatInput,
  ChatMessage,
  ChatSettings,
  DcrRole,
  ExpectedAnswerType,
  GraphCandidate,
  SearchIndex,
} from "./types";
import "./styles.css";

type AnalysisTab = "supporting" | "citation" | "graph";
type Drawer = "history" | "settings" | null;

const MODE_TITLES = {
  "dcr-controller": "DCR Chat",
  rag: "Pure RAG Chat",
  dcr: "DCR Graph Chat",
} as const;

const ROLE_LABELS = {
  user: "You",
  assistant: "Assistant",
  robot: "Robot",
  system: "System",
} as const;

const formatDate = (value?: string) => {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
};

export function ChatApp({
  mode,
  messages,
  settings,
  sessions = [],
  activeSessionId,
  title,
  loading = false,
  error,
  notice,
  inputDisabled = false,
  inputDisabledReason,
  expectedAnswerType,
  placeholder = "Write a message…",
  graphPanel,
  citationPanel,
  hasCachedCitizenInformation = false,
  onSend,
  onEditAnswer,
  onClear,
  onSettingsChange,
  onSelectSession,
  onDeleteSession,
  onDeleteAllSessions,
  onSelectCandidate,
  onFollowup,
  onCitationSelect,
  onBack,
  onStop,
}: ChatAppProps) {
  const [draft, setDraft] = useState("");
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [analysisTab, setAnalysisTab] = useState<AnalysisTab>();
  const [selectedMessageId, setSelectedMessageId] = useState<string>();
  const [selectedCitationId, setSelectedCitationId] = useState<string>();
  const [editingMessageId, setEditingMessageId] = useState<string>();
  const [editingDraft, setEditingDraft] = useState("");
  const [editError, setEditError] = useState<string>();
  const streamEnd = useRef<HTMLDivElement>(null);

  const selectedMessage = useMemo(
    () => messages.find((message) => message.id === selectedMessageId),
    [messages, selectedMessageId],
  );
  const selectedCitation = selectedMessage?.citations?.find(
    (citation) => citation.id === selectedCitationId,
  );
  const hasAnalysis = Boolean(analysisTab && (selectedMessage || analysisTab === "graph"));
  const isRag = mode === "rag";
  const composerDisabled = loading || inputDisabled;

  useEffect(() => {
    streamEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading]);

  useEffect(() => {
    if (selectedMessageId && !selectedMessage) {
      setSelectedMessageId(undefined);
      setSelectedCitationId(undefined);
      setAnalysisTab(graphPanel ? "graph" : undefined);
    }
  }, [graphPanel, selectedMessage, selectedMessageId]);

  const updateSetting = <Key extends keyof ChatSettings>(
    key: Key,
    value: ChatSettings[Key],
  ) => onSettingsChange({ ...settings, [key]: value });

  const openSupportingContent = (message: ChatMessage) => {
    setSelectedMessageId(message.id);
    setAnalysisTab("supporting");
  };

  const selectCitation = (citation: ChatCitation, message: ChatMessage) => {
    setSelectedMessageId(message.id);
    setSelectedCitationId(citation.id);
    setAnalysisTab("citation");
    void onCitationSelect(citation, message);
  };

  const openCitations = (message: ChatMessage) => {
    const citation = message.citations?.[0];
    if (citation) {
      selectCitation(citation, message);
      return;
    }
    setSelectedMessageId(message.id);
    setSelectedCitationId(undefined);
    setAnalysisTab("citation");
  };

  const openGraph = () => {
    setAnalysisTab("graph");
    setDrawer(null);
  };

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || composerDisabled) return;
    setDraft("");
    void onSend(text);
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  const startEditing = (message: ChatMessage) => {
    setEditingMessageId(message.id);
    setEditingDraft(message.content);
    setEditError(undefined);
  };

  const submitEdit = async (event: FormEvent, message: ChatMessage) => {
    event.preventDefault();
    const text = editingDraft.trim();
    if (!text || text === message.content || !onEditAnswer) return;
    const input = typedAnswer(text, message.answerType);
    if (input === undefined) {
      setEditError(message.answerType === "int" ? "Enter a whole number." : "Enter Yes or No.");
      return;
    }
    await onEditAnswer(message.id, input);
    setEditingMessageId(undefined);
    setEditingDraft("");
    setEditError(undefined);
  };

  return (
    <section className={`dcrChat${hasAnalysis ? " dcrChat--analysis" : ""}`}>
      <header className="dcrChat__header">
        <div className="dcrChat__titleGroup">
          {onBack && (
            <button className="dcrChat__iconButton" type="button" onClick={() => void onBack()}>
              ← <span>Back</span>
            </button>
          )}
          <div>
            <h1>{title ?? MODE_TITLES[mode]}</h1>
            <span className="dcrChat__mode">{MODE_TITLES[mode]}</span>
          </div>
        </div>
        <nav className="dcrChat__commands" aria-label="Chat controls">
          {graphPanel && (
            <button type="button" onClick={openGraph} aria-pressed={analysisTab === "graph"}>
              DCR Graph
            </button>
          )}
          <button type="button" disabled={loading} onClick={() => setDrawer("history")}>
            History
          </button>
          <button type="button" disabled={loading} onClick={() => setDrawer("settings")}>
            Settings
          </button>
          <button type="button" onClick={() => void onClear()} disabled={loading}>
            Clear chat
          </button>
        </nav>
      </header>

      <div className="dcrChat__workspace">
        <main className="dcrChat__conversation">
          <div className="dcrChat__messages" aria-live="polite">
            {messages.length === 0 && !loading && (
              <div className="dcrChat__empty">
                <h2>{MODE_TITLES[mode]}</h2>
                <p>
                  {isRag
                    ? "Ask a question to search relevant laws and similar cases."
                    : "Ask for guidance through the DCR process."}
                </p>
              </div>
            )}

            {messages.map((message) => (
              <article
                className={`dcrChat__message dcrChat__message--${message.role}`}
                key={message.id}
              >
                <div className="dcrChat__messageHeading">
                  <strong>{ROLE_LABELS[message.role]}</strong>
                  {message.dcrRole && <span>{message.dcrRole}</span>}
                  {message.role === "user" && message.editable && onEditAnswer && (
                    <button
                      className="dcrChat__editAnswer"
                      type="button"
                      aria-label="Edit answer"
                      title="Edit answer"
                      disabled={loading}
                      onClick={() => startEditing(message)}
                    >
                      ✎
                    </button>
                  )}
                  {message.createdAt && <time dateTime={message.createdAt}>{formatDate(message.createdAt)}</time>}
                </div>
                {editingMessageId === message.id ? (
                  <form className="dcrChat__answerEditor" onSubmit={(event) => void submitEdit(event, message)}>
                    <textarea
                      aria-label="Edit answer text"
                      autoFocus
                      rows={2}
                      value={editingDraft}
                      disabled={loading}
                      onChange={(event) => setEditingDraft(event.target.value)}
                    />
                    {editError && <small className="dcrChat__fieldError">{editError}</small>}
                    <div>
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() => {
                          setEditingMessageId(undefined);
                          setEditError(undefined);
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={loading || !editingDraft.trim() || editingDraft.trim() === message.content}
                      >
                        Save
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="dcrChat__markdown">
                    <CitationMarkdown
                      message={message}
                      candidateSelectionDisabled={loading}
                      onCandidateSelect={(candidate) => {
                        void onSelectCandidate(candidate, message);
                      }}
                      onSelect={selectCitation}
                    />
                  </div>
                )}
                {message.role === "user" && message.interpretedValue && (
                  <small className="dcrChat__interpretation">
                    Interpreted as: {message.interpretedValue}
                  </small>
                )}

                {!!message.citations?.length && (
                  <div className="dcrChat__citations" aria-label="Citations">
                    <span>Citations:</span>
                    {message.citations.map((citation, index) => (
                      <button
                        key={citation.id}
                        type="button"
                        title={citation.source}
                        onClick={() => selectCitation(citation, message)}
                      >
                        [{index + 1}] {citation.title}
                      </button>
                    ))}
                  </div>
                )}

                {(message.supportingContent?.length || message.citations?.length) && (
                  <div className="dcrChat__messageActions">
                    {!!message.supportingContent?.length && (
                      <button type="button" onClick={() => openSupportingContent(message)}>
                        Supporting Content
                      </button>
                    )}
                    {(!!message.citations?.length || hasToolResult(message)) && (
                      <button type="button" onClick={() => openCitations(message)}>
                        Citation
                      </button>
                    )}
                  </div>
                )}

                {!!message.followups?.length && (
                  <div className="dcrChat__followups" aria-label="Suggested follow-up statements">
                    <span>Suggested follow-up statements</span>
                    {message.followups.map((question) => (
                      <button key={question} type="button" onClick={() => void onFollowup(question, message)}>
                        {question}
                      </button>
                    ))}
                  </div>
                )}
              </article>
            ))}

            {loading && (
              <div className="dcrChat__loading" role="status">
                <span />
                <span />
                <span />
                <span className="dcrChat__srOnly">Generating an answer</span>
              </div>
            )}
            <div ref={streamEnd} />
          </div>

          <div className="dcrChat__composerArea">
            {error && <div className="dcrChat__error" role="alert">{error}</div>}
            {notice && (
              <div className="dcrChat__notice dcrChat__notice--activity" role="status">
                {notice}
              </div>
            )}
            {inputDisabled && inputDisabledReason && (
              <div className="dcrChat__notice" role="status">{inputDisabledReason}</div>
            )}
            {expectedAnswerType && (
              <ExpectedAnswerWidget
                type={expectedAnswerType}
                disabled={composerDisabled}
                onSubmit={onSend}
              />
            )}
            <form className="dcrChat__composer" onSubmit={submit}>
              <textarea
                aria-label="Chat message"
                rows={2}
                value={draft}
                placeholder={inputDisabledReason ?? placeholder}
                disabled={composerDisabled}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleComposerKeyDown}
              />
              {loading && onStop ? (
                <button className="dcrChat__stop" type="button" onClick={() => void onStop()}>
                  Stop
                </button>
              ) : (
                <button type="submit" disabled={composerDisabled || !draft.trim()}>
                  Send
                </button>
              )}
            </form>
          </div>
        </main>

        {hasAnalysis && (
          <aside className="dcrChat__analysis" aria-label="Answer analysis">
            <div className="dcrChat__analysisHeader">
              <div className="dcrChat__tabs" role="tablist" aria-label="Analysis views">
                <button
                  role="tab"
                  type="button"
                  aria-selected={analysisTab === "supporting"}
                  disabled={!selectedMessage?.supportingContent?.length}
                  onClick={() => selectedMessage && openSupportingContent(selectedMessage)}
                >
                  Supporting Content
                </button>
                <button
                  role="tab"
                  type="button"
                  aria-selected={analysisTab === "citation"}
                  disabled={!selectedMessage || (
                    !selectedMessage.citations?.length && !hasToolResult(selectedMessage)
                  )}
                  onClick={() => selectedMessage && openCitations(selectedMessage)}
                >
                  Citation
                </button>
                {graphPanel && (
                  <button
                    role="tab"
                    type="button"
                    aria-selected={analysisTab === "graph"}
                    onClick={openGraph}
                  >
                    DCR Graph
                  </button>
                )}
              </div>
              <button
                className="dcrChat__close"
                type="button"
                aria-label="Close analysis"
                onClick={() => setAnalysisTab(undefined)}
              >
                ×
              </button>
            </div>

            <div className="dcrChat__analysisBody" role="tabpanel">
              {analysisTab === "supporting" && (
                <SupportingContent items={selectedMessage?.supportingContent ?? []} />
              )}
              {analysisTab === "citation" && selectedMessage && (
                <CitationContent
                  citations={selectedMessage.citations ?? []}
                  selectedCitation={selectedCitation}
                  message={selectedMessage}
                  panel={citationPanel}
                  onSelect={selectCitation}
                />
              )}
              {analysisTab === "graph" && graphPanel}
            </div>
          </aside>
        )}
      </div>

      {drawer && (
        <>
          <button
            className="dcrChat__backdrop"
            type="button"
            aria-label="Close panel"
            onClick={() => setDrawer(null)}
          />
          <aside className="dcrChat__drawer" aria-label={drawer === "history" ? "Chat history" : "Chat settings"}>
            <div className="dcrChat__drawerHeader">
              <h2>{drawer === "history" ? "Chat history" : "Configure answer generation"}</h2>
              <button type="button" aria-label="Close panel" onClick={() => setDrawer(null)}>×</button>
            </div>
            {drawer === "history" ? (
              <History
                sessions={sessions}
                activeSessionId={activeSessionId}
                busy={loading}
                onSelect={(id) => {
                  setDrawer(null);
                  void onSelectSession(id);
                }}
                onDelete={(id) => void onDeleteSession(id)}
                onDeleteAll={() => void onDeleteAllSessions()}
              />
            ) : (
              <Settings
                isRag={isRag}
                busy={loading}
                value={settings}
                hasCachedCitizenInformation={hasCachedCitizenInformation}
                onDcrRoleChange={(value) => void updateSetting("dcrRole", value)}
                onRobotAutoExecutionsChange={(value) => void updateSetting("robotAutoExecutionsPerActivity", value)}
                onActivityRepetitionsChange={(value) => void updateSetting("activityRepetitions", value)}
                onCitizenInformationChange={(value) => void updateSetting("useCitizenInformation", value)}
                onSearchIndexChange={(value) => void updateSetting("searchIndex", value)}
                onFollowupsChange={(value) => void updateSetting("suggestFollowupQuestions", value)}
              />
            )}
          </aside>
        </>
      )}
    </section>
  );
}

interface ExpectedAnswerWidgetProps {
  type: ExpectedAnswerType;
  disabled: boolean;
  onSubmit: (input: ChatInput) => void | Promise<void>;
}

function ExpectedAnswerWidget({ type, disabled, onSubmit }: ExpectedAnswerWidgetProps) {
  const [integer, setInteger] = useState("");
  const [error, setError] = useState<string>();

  useEffect(() => {
    setInteger("");
    setError(undefined);
  }, [type]);

  if (type === "bool") {
    return (
      <div className="dcrChat__answerWidget" aria-label="Expected Boolean answer">
        <span>Choose an answer</span>
        <div>
          <button type="button" disabled={disabled} onClick={() => void onSubmit(true)}>Yes</button>
          <button type="button" disabled={disabled} onClick={() => void onSubmit(false)}>No</button>
        </div>
      </div>
    );
  }

  const submitInteger = (event: FormEvent) => {
    event.preventDefault();
    const value = Number(integer);
    if (!/^-?\d+$/.test(integer.trim()) || !Number.isSafeInteger(value)) {
      setError("Enter a whole number.");
      return;
    }
    setInteger("");
    setError(undefined);
    void onSubmit(value);
  };

  return (
    <form className="dcrChat__answerWidget" aria-label="Expected Integer answer" onSubmit={submitInteger}>
      <label>
        <span>Enter a whole number</span>
        <input
          type="number"
          step="1"
          inputMode="numeric"
          value={integer}
          disabled={disabled}
          onChange={(event) => {
            setInteger(event.target.value);
            setError(undefined);
          }}
        />
      </label>
      <button type="submit" disabled={disabled || !integer.trim()}>Submit</button>
      {error && <small className="dcrChat__fieldError">{error}</small>}
    </form>
  );
}

function typedAnswer(value: string, type?: ExpectedAnswerType): ChatInput | undefined {
  if (type === "int") {
    const number = Number(value);
    return /^-?\d+$/.test(value) && Number.isSafeInteger(number) ? number : undefined;
  }
  if (type === "bool") {
    if (/^(yes|true)$/i.test(value)) return true;
    if (/^(no|false)$/i.test(value)) return false;
    return undefined;
  }
  return value;
}

interface CitationMarkdownProps {
  message: ChatMessage;
  candidateSelectionDisabled: boolean;
  onCandidateSelect: (candidate: GraphCandidate) => void;
  onSelect: (citation: ChatCitation, message: ChatMessage) => void;
}

/** Adds inline controls for process options and source citations. */
function CitationMarkdown({
  message,
  candidateSelectionDisabled,
  onCandidateSelect,
  onSelect,
}: CitationMarkdownProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => {
          const candidateMatch = href?.match(/^#dcr-chat-candidate-(\d+)$/);
          const candidate = candidateMatch
            ? message.candidates?.[Number(candidateMatch[1])]
            : undefined;
          if (candidate) {
            return (
              <a
                aria-disabled={candidateSelectionDisabled}
                className="dcrChat__inlineCandidate"
                href={href}
                tabIndex={candidateSelectionDisabled ? -1 : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  if (!candidateSelectionDisabled) onCandidateSelect(candidate);
                }}
              >
                {children}
              </a>
            );
          }
          const match = href?.match(/^#dcr-chat-citation-(\d+)$/);
          const citation = match ? message.citations?.[Number(match[1])] : undefined;
          if (!citation) return <a href={href}>{children}</a>;
          return (
            <a
              className="dcrChat__inlineCitation"
              href={href}
              title={citation.title}
              onClick={(event) => {
                event.preventDefault();
                onSelect(citation, message);
              }}
            >
              {children}
            </a>
          );
        },
      }}
    >
      {linkCandidateOptions(message, numberCitationMarkers(message))}
    </ReactMarkdown>
  );
}

function linkCandidateOptions(message: ChatMessage, content: string): string {
  if (!message.candidates?.length) return content;
  return content.replace(/\bOption\s+(\d+)\b(?!\]\()/gi, (label, number: string) => {
    const index = Number(number) - 1;
    return message.candidates?.[index]
      ? `[${label}](#dcr-chat-candidate-${index})`
      : label;
  });
}

function numberCitationMarkers(message: ChatMessage): string {
  const citations = message.citations ?? [];
  if (!citations.length) return message.content;

  const sourceCounts = new Map<string, number>();
  for (const citation of citations) {
    sourceCounts.set(citation.source, (sourceCounts.get(citation.source) ?? 0) + 1);
  }

  const citationNumbers = new Map<string, number>();
  citations.forEach((citation, index) => {
    const marker = citation.page
      ? `${citation.source}#page=${citation.page}`
      : citation.source;
    citationNumbers.set(marker, index);
    if (sourceCounts.get(citation.source) === 1) {
      citationNumbers.set(citation.source, index);
    }
  });

  return message.content.replace(/\[([^\]\r\n]+)\](?!\()/g, (original, marker: string) => {
    const index = citationNumbers.get(marker.trim());
    return index === undefined
      ? original
      : `[[${index + 1}]](#dcr-chat-citation-${index})`;
  });
}

function SupportingContent({ items }: { items: NonNullable<ChatMessage["supportingContent"]> }) {
  if (!items.length) return <p>No supporting content is available for this answer.</p>;
  return (
    <div className="dcrChat__supportingContent">
      {items.map((item) => (
        <article key={item.id}>
          <h3>{item.url ? <a href={item.url} target="_blank" rel="noreferrer">{item.title}</a> : item.title}</h3>
          <div className="dcrChat__markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{item.content}</ReactMarkdown></div>
          {item.source && <small>{item.source}</small>}
          {item.metadata && (
            <dl>
              {Object.entries(item.metadata).map(([key, value]) => (
                <div key={key}><dt>{key}</dt><dd>{String(value ?? "")}</dd></div>
              ))}
            </dl>
          )}
        </article>
      ))}
    </div>
  );
}

function hasToolResult(message: ChatMessage): boolean {
  return message.supportingContent?.some((item) => {
    const toolCall = item.metadata?.toolCall;
    return typeof toolCall === "string" && Boolean(toolCall.trim());
  }) ?? false;
}

interface CitationContentProps {
  citations: readonly ChatCitation[];
  selectedCitation?: ChatCitation;
  message: ChatMessage;
  panel?: ReactNode;
  onSelect: (citation: ChatCitation, message: ChatMessage) => void;
}

function CitationContent({ citations, selectedCitation, message, panel, onSelect }: CitationContentProps) {
  if (!citations.length) return <p>No citations are available for this answer.</p>;
  return (
    <div className="dcrChat__citationContent">
      <div className="dcrChat__citationList">
        {citations.map((citation, index) => (
          <button
            className={citation.id === selectedCitation?.id ? "is-active" : ""}
            key={citation.id}
            type="button"
            onClick={() => onSelect(citation, message)}
          >
            <strong>[{index + 1}] {citation.title}</strong>
            <span>{citation.page ? `${citation.source} · page ${citation.page}` : citation.source}</span>
          </button>
        ))}
      </div>
      {selectedCitation?.excerpt && <blockquote>{selectedCitation.excerpt}</blockquote>}
      {panel && <div className="dcrChat__citationPanel">{panel}</div>}
    </div>
  );
}

interface HistoryProps {
  sessions: ChatAppProps["sessions"];
  activeSessionId?: string;
  busy: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onDeleteAll: () => void;
}

function History({
  sessions = [],
  activeSessionId,
  busy,
  onSelect,
  onDelete,
  onDeleteAll,
}: HistoryProps) {
  if (!sessions.length) return <p className="dcrChat__drawerEmpty">No previous chats.</p>;
  return (
    <div>
      <div className="dcrChat__historyActions">
        <button type="button" disabled={busy} onClick={onDeleteAll}>
          Delete all history
        </button>
      </div>
      <ul className="dcrChat__history">
        {sessions.map((session) => (
          <li className={session.id === activeSessionId ? "is-active" : ""} key={session.id}>
            <button className="dcrChat__historySelect" type="button" disabled={busy} onClick={() => onSelect(session.id)}>
              <strong>{session.title}</strong>
              {session.graphName && <span>{session.graphName}</span>}
              {session.preview && <span>{session.preview}</span>}
              {session.updatedAt && <time dateTime={session.updatedAt}>{formatDate(session.updatedAt)}</time>}
            </button>
            <button className="dcrChat__historyDelete" type="button" disabled={busy} aria-label={`Delete ${session.title}`} onClick={() => onDelete(session.id)}>
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface SettingsProps {
  isRag: boolean;
  busy: boolean;
  value: ChatSettings;
  hasCachedCitizenInformation: boolean;
  onDcrRoleChange: (value: DcrRole) => void;
  onRobotAutoExecutionsChange: (value: number) => void;
  onActivityRepetitionsChange: (value: number) => void;
  onCitizenInformationChange: (value: boolean) => void;
  onSearchIndexChange: (value: SearchIndex) => void;
  onFollowupsChange: (value: boolean) => void;
}

function Settings({
  isRag,
  busy,
  value,
  hasCachedCitizenInformation,
  onDcrRoleChange,
  onRobotAutoExecutionsChange,
  onActivityRepetitionsChange,
  onCitizenInformationChange,
  onSearchIndexChange,
  onFollowupsChange,
}: SettingsProps) {
  return (
    <form className="dcrChat__settings">
      <label>
        <span>DCR Role</span>
        <select
          value={value.dcrRole}
          disabled={isRag || busy}
          onChange={(event) => onDcrRoleChange(event.target.value as DcrRole)}
        >
          <option value="Citizen">Citizen</option>
          <option value="Caseworker">Caseworker</option>
        </select>
        <small>{isRag ? "DCR roles apply only to DCR chats." : "Determines which enabled activities the chat may present."}</small>
      </label>

      <label>
        <span>Automatic Robot executions per activity</span>
        <input
          type="number"
          min={-1}
          step={1}
          value={value.robotAutoExecutionsPerActivity}
          disabled={isRag || busy}
          onChange={(event) => {
            const limit = event.currentTarget.valueAsNumber;
            if (Number.isInteger(limit) && limit >= -1) {
              onRobotAutoExecutionsChange(limit);
            }
          }}
        />
        <small>
          {isRag
            ? "Robot execution settings apply only to DCR chats."
            : "Use -1 for unlimited automatic executions, 0 to always require Caseworker confirmation, or a positive limit for each Robot activity."}
        </small>
      </label>

      <label>
        <span>Repeat executed activities</span>
        <input
          type="number"
          min={-1}
          step={1}
          value={value.activityRepetitions}
          disabled={isRag || busy}
          onChange={(event) => {
            const limit = event.currentTarget.valueAsNumber;
            if (Number.isInteger(limit) && limit >= -1) {
              onActivityRepetitionsChange(limit);
            }
          }}
        />
        <small>
          {isRag
            ? "Activity repetition settings apply only to DCR chats."
            : "Use -1 for unlimited repetitions, 0 for no repetitions, or a positive number for the allowed repetitions."}
        </small>
      </label>

      <label className="dcrChat__checkbox">
        <input
          type="checkbox"
          checked={value.useCitizenInformation}
          disabled={!hasCachedCitizenInformation || busy}
          onChange={(event) => onCitizenInformationChange(event.target.checked)}
        />
        <span>Use Citizen Information</span>
        {!hasCachedCitizenInformation && (
          <small>No Citizen Information is available.</small>
        )}
      </label>

      <label>
        <span>Search index</span>
        <select
          value={value.searchIndex}
          disabled={!isRag || busy}
          onChange={(event) => onSearchIndexChange(event.target.value as SearchIndex)}
        >
          <option value="All">All</option>
          <option value="Relevant laws">Relevant laws</option>
          <option value="Similar cases">Similar cases</option>
        </select>
        <small>{isRag ? "All searches both relevant laws and similar cases." : "Search settings apply only to Pure RAG Chat."}</small>
      </label>

      <label className="dcrChat__checkbox">
        <input
          type="checkbox"
          checked={value.suggestFollowupQuestions}
          disabled={!isRag || busy}
          onChange={(event) => onFollowupsChange(event.target.checked)}
        />
        <span>Suggest follow-up statements</span>
      </label>

      <label>
        <span>Retrieve count</span>
        <input type="number" value={value.retrieveCount} disabled readOnly />
      </label>
      <label>
        <span>Minimum search score</span>
        <input type="number" value={value.minimumSearchScore} disabled readOnly />
      </label>
      <p className="dcrChat__settingsNotice">Retrieve count and minimum score are not supported by the current backend.</p>
    </form>
  );
}
