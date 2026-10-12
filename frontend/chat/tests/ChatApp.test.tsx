// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ChatApp,
  DEFAULT_ACTIVITY_REPETITIONS,
  DEFAULT_ROBOT_AUTO_EXECUTIONS_PER_ACTIVITY,
  type ChatAppProps,
  type ChatSettings,
} from "../src";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const settings: ChatSettings = {
  dcrRole: "Citizen",
  robotAutoExecutionsPerActivity: DEFAULT_ROBOT_AUTO_EXECUTIONS_PER_ACTIVITY,
  executeOnlyPendingRobotActivities: true,
  activityRepetitions: DEFAULT_ACTIVITY_REPETITIONS,
  useChatHistory: true,
  useChatData: true,
  useCitizenInformation: false,
  searchIndex: "All",
  suggestFollowupQuestions: true,
  retrieveCount: 5,
  minimumSearchScore: 0,
};

const props: ChatAppProps = {
  mode: "dcr-controller",
  messages: [],
  settings,
  onSend: vi.fn(),
  onClear: vi.fn(),
  onSettingsChange: vi.fn(),
  onSelectSession: vi.fn(),
  onDeleteSession: vi.fn(),
  onDeleteAllSessions: vi.fn(),
  onSelectCandidate: vi.fn(),
  onFollowup: vi.fn(),
  onCitationSelect: vi.fn(),
};

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

describe("ChatApp", () => {
  it("deletes all chat history from the History drawer", () => {
    const onDeleteAllSessions = vi.fn();
    render(
      <ChatApp
        {...props}
        sessions={[{ id: "session-1", title: "Previous chat", mode: "rag" }]}
        onDeleteAllSessions={onDeleteAllSessions}
      />,
    );

    act(() => button("History")?.click());
    act(() => button("Delete all history")?.click());

    expect(onDeleteAllSessions).toHaveBeenCalledOnce();
  });

  it("makes inline process options clickable without a separate option list", () => {
    const onSelectCandidate = vi.fn();
    render(
      <ChatApp
        {...props}
        onSelectCandidate={onSelectCandidate}
        messages={[
          {
            id: "answer-1",
            role: "assistant",
            content: "Option 1 covers applications for housing support.",
            candidates: [
              {
                id: "graph-1",
                description: "Apply for housing support",
                source: "secret-file-name.xml",
              },
            ],
          },
        ]}
      />,
    );

    const option = container?.querySelector<HTMLAnchorElement>(
      ".dcrChat__inlineCandidate",
    );
    expect(option?.textContent).toBe("Option 1");
    expect(container?.querySelector(".dcrChat__candidates")).toBeNull();
    expect(container?.innerHTML).not.toContain("secret-file-name.xml");

    act(() => option?.click());
    expect(onSelectCandidate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "graph-1" }),
      expect.objectContaining({ id: "answer-1" }),
    );
  });

  it("renders analysis tabs in the required order", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <ChatApp
          {...props}
          graphPanel={<div>Graph viewer</div>}
          messages={[
            {
              id: "answer-1",
              role: "assistant",
              content: "Answer",
              supportingContent: [{ id: "e-1", title: "Law", content: "Evidence" }],
              citations: [{ id: "c-1", title: "Law 1", source: "law.pdf" }],
            },
          ]}
        />,
      );
    });

    const supportingButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Supporting Content",
    );
    act(() => supportingButton?.click());

    const tabs = [...container.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent);
    expect(tabs).toEqual(["Supporting Content", "Citation", "DCR Graph"]);
  });

  it("enables only the settings supported by the active mode", () => {
    render(<ChatApp {...props} hasCachedCitizenInformation />);
    act(() => button("Settings")?.click());

    expect(field("DCR Role")?.disabled).toBe(false);
    expect(field("Automatic Robot executions per activity")?.disabled).toBe(false);
    expect(field("Repeat executed activities")?.disabled).toBe(false);
    expect((field("Use chat history") as HTMLInputElement)?.checked).toBe(true);
    expect((field("Use chat data") as HTMLInputElement)?.checked).toBe(true);
    expect(field("Use Citizen Information")?.disabled).toBe(false);
    expect(field("Search index")?.disabled).toBe(true);
    expect(field("Suggest follow-up statements")?.disabled).toBe(true);
    expect(field("Retrieve count")?.disabled).toBe(true);
    expect(field("Minimum search score")?.disabled).toBe(true);

    render(<ChatApp {...props} mode="rag" hasCachedCitizenInformation />);
    expect(field("DCR Role")?.disabled).toBe(true);
    expect(field("Automatic Robot executions per activity")?.disabled).toBe(true);
    expect(field("Repeat executed activities")?.disabled).toBe(true);
    expect(field("Use chat history")?.disabled).toBe(false);
    expect(field("Use chat data")?.disabled).toBe(true);
    expect(field("Use Citizen Information")?.disabled).toBe(false);
    expect(field("Search index")?.disabled).toBe(false);
    expect(field("Suggest follow-up statements")?.disabled).toBe(false);
    expect(field("Retrieve count")?.disabled).toBe(true);
    expect(field("Minimum search score")?.disabled).toBe(true);
  });

  it("updates the Citizen Information setting", () => {
    const onSettingsChange = vi.fn();
    render(
      <ChatApp
        {...props}
        hasCachedCitizenInformation
        onSettingsChange={onSettingsChange}
      />,
    );
    act(() => button("Settings")?.click());

    act(() => field("Use Citizen Information")?.click());
    expect(onSettingsChange).toHaveBeenCalledWith({
      ...settings,
      useCitizenInformation: true,
    });
  });

  it("updates chat history and chat data settings", () => {
    const onSettingsChange = vi.fn();
    render(<ChatApp {...props} onSettingsChange={onSettingsChange} />);
    act(() => button("Settings")?.click());

    act(() => field("Use chat history")?.click());
    expect(onSettingsChange).toHaveBeenCalledWith({
      ...settings,
      useChatHistory: false,
    });

    act(() => field("Use chat data")?.click());
    expect(onSettingsChange).toHaveBeenCalledWith({
      ...settings,
      useChatData: false,
    });
  });

  it("configures the backend Robot execution policy semantics", () => {
    const onSettingsChange = vi.fn();
    render(<ChatApp {...props} onSettingsChange={onSettingsChange} />);
    act(() => button("Settings")?.click());

    const robotLimit = field("Automatic Robot executions per activity") as HTMLInputElement;
    expect(DEFAULT_ROBOT_AUTO_EXECUTIONS_PER_ACTIVITY).toBe(1);
    expect(robotLimit.min).toBe("-1");
    expect(robotLimit.step).toBe("1");
    expect(container?.textContent).toContain("-1 for unlimited automatic executions");
    expect(container?.textContent).toContain("0 to always require Caseworker confirmation");

    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")
        ?.set?.call(robotLimit, "0");
      robotLimit.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onSettingsChange).toHaveBeenCalledWith({
      ...settings,
      robotAutoExecutionsPerActivity: 0,
    });

    const pendingOnly = field("Execute only pending Robot activities") as HTMLInputElement;
    expect(pendingOnly.checked).toBe(true);
    act(() => pendingOnly.click());
    expect(onSettingsChange).toHaveBeenLastCalledWith({
      ...settings,
      executeOnlyPendingRobotActivities: false,
    });
  });

  it("configures how many times executed activities may repeat", () => {
    const onSettingsChange = vi.fn();
    render(<ChatApp {...props} onSettingsChange={onSettingsChange} />);
    act(() => button("Settings")?.click());

    const repeatLimit = field("Repeat executed activities") as HTMLInputElement;
    expect(DEFAULT_ACTIVITY_REPETITIONS).toBe(0);
    expect(repeatLimit.min).toBe("-1");
    expect(repeatLimit.step).toBe("1");

    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")
        ?.set?.call(repeatLimit, "2");
      repeatLimit.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onSettingsChange).toHaveBeenCalledWith({
      ...settings,
      activityRepetitions: 2,
    });
  });

  it("renders automatic Robot activity notices without blocking the composer", () => {
    render(<ChatApp {...props} notice="Robot activity Check law was executed automatically." />);

    const notice = container?.querySelector(".dcrChat__notice--activity");
    expect(notice?.textContent).toContain("executed automatically");
    expect(notice?.getAttribute("role")).toBe("status");
    expect(container?.querySelector<HTMLTextAreaElement>("textarea")?.disabled).toBe(false);
  });

  it("renders wait reasons and invokes follow-up and citation callbacks", () => {
    const onFollowup = vi.fn();
    const onCitationSelect = vi.fn();
    render(
      <ChatApp
        {...props}
        inputDisabled
        inputDisabledReason="You must wait for the Caseworker."
        onFollowup={onFollowup}
        onCitationSelect={onCitationSelect}
        messages={[{
          id: "answer",
          role: "assistant",
          content: "Answer",
          citations: [{ id: "law", title: "Law", source: "law.pdf" }],
          followups: ["I want information about what happens next."],
        }]}
      />,
    );

    expect(container?.textContent).toContain("You must wait for the Caseworker.");
    act(() => button("I want information about what happens next.")?.click());
    act(() => button("[1] Law")?.click());
    expect(onFollowup).toHaveBeenCalledWith(
      "I want information about what happens next.",
      expect.objectContaining({ id: "answer" }),
    );
    expect(onCitationSelect).toHaveBeenCalledWith(
      expect.objectContaining({ source: "law.pdf" }),
      expect.objectContaining({ id: "answer" }),
    );
  });

  it("renders source markers as numbered links that open the citation panel", () => {
    const onCitationSelect = vi.fn();
    render(
      <ChatApp
        {...props}
        onCitationSelect={onCitationSelect}
        messages={[{
          id: "answer",
          role: "assistant",
          content: "See [guidelines.pdf#page=59] and [case.json].",
          citations: [
            { id: "law", title: "Guidelines", source: "guidelines.pdf", page: 59 },
            { id: "case", title: "Case", source: "case.json" },
          ],
        }]}
      />,
    );

    const markdown = container?.querySelector(".dcrChat__markdown");
    expect(markdown?.textContent).toBe("See [1] and [2].");
    expect(markdown?.textContent).not.toContain("guidelines.pdf");

    const firstCitation = [...(markdown?.querySelectorAll("a") ?? [])][0];
    act(() => firstCitation?.click());

    expect(onCitationSelect).toHaveBeenCalledWith(
      expect.objectContaining({ source: "guidelines.pdf", page: 59 }),
      expect.objectContaining({ id: "answer" }),
    );
    expect(container?.querySelector('[role="tabpanel"]')).toBeTruthy();
  });

  it("opens both analysis views for a citation-free tool result", () => {
    const onCitationSelect = vi.fn();
    render(
      <ChatApp
        {...props}
        onCitationSelect={onCitationSelect}
        messages={[{
          id: "summary",
          role: "assistant",
          content: "Case summary",
          supportingContent: [{
            id: "summary-result",
            title: "Summarize case",
            content: "The generated summary",
            metadata: { toolCall: "summarize_case_history" },
          }],
          citations: [],
        }]}
      />,
    );

    const message = container?.querySelector(".dcrChat__message--assistant");
    expect(message?.querySelector(".dcrChat__messageHeading .dcrChat__supportButton")).not.toBeNull();
    const actions = [...(message?.querySelectorAll(".dcrChat__messageActions button") ?? [])];
    expect(actions.map((action) => action.textContent)).toEqual([
      "Supporting Content",
      "Citation",
    ]);

    act(() => actions[0]?.click());
    expect(container?.querySelector('[role="tabpanel"]')?.textContent)
      .toContain("The generated summary");
    act(() => actions[1]?.click());
    expect(container?.querySelector('[role="tabpanel"]')?.textContent)
      .toContain("No citations are available for this answer.");
    expect(onCitationSelect).not.toHaveBeenCalled();
  });

  it("shows trust-colored wrenches only on tool-call answers", () => {
    render(
      <ChatApp
        {...props}
        messages={[
          { id: "trusted", role: "robot", content: "Trusted result", toolTrusted: true },
          { id: "untrusted", role: "assistant", content: "Untrusted result", toolTrusted: false },
          { id: "ordinary", role: "assistant", content: "Ordinary answer" },
        ]}
      />,
    );

    expect(container?.querySelectorAll(".dcrChat__toolTrust")).toHaveLength(2);
    expect(container?.querySelector('[aria-label="Trusted tool call"]')
      ?.classList.contains("dcrChat__toolTrust--trusted")).toBe(true);
    expect(container?.querySelector('[aria-label="Untrusted tool call"]')
      ?.classList.contains("dcrChat__toolTrust--untrusted")).toBe(true);
    expect(container?.querySelectorAll(".dcrChat__message")[2]
      ?.querySelector(".dcrChat__toolTrust")).toBeNull();
  });

  it("renders Robot executions as Assistant with the Robot DCR role", () => {
    render(
      <ChatApp
        {...props}
        messages={[{
          id: "robot-execution",
          role: "assistant",
          dcrRole: "Robot",
          content: "Robot result",
        }]}
      />,
    );

    const heading = container?.querySelector(".dcrChat__messageHeading");
    expect(heading?.querySelector("strong")?.textContent).toBe("Assistant");
    expect(heading?.querySelector("span")?.textContent).toBe("Robot");
  });

  it("renders interpreted values beneath the original user answer", () => {
    render(
      <ChatApp
        {...props}
        messages={[{
          id: "answer",
          role: "user",
          content: "we shook hands",
          interpretedValue: "True",
        }]}
      />,
    );

    const userMessage = container?.querySelector(".dcrChat__message--user");
    expect(userMessage?.querySelector(".dcrChat__markdown")?.textContent).toBe(
      "we shook hands",
    );
    expect(userMessage?.querySelector(".dcrChat__interpretation")?.textContent).toBe(
      "Interpreted as: True",
    );
    expect(container?.querySelectorAll(".dcrChat__message")).toHaveLength(1);
  });

  it("lets the user edit an editable answer", async () => {
    const onEditAnswer = vi.fn().mockResolvedValue(undefined);
    render(
      <ChatApp
        {...props}
        onEditAnswer={onEditAnswer}
        messages={[{
          id: "answer",
          role: "user",
          content: "Old answer",
          editable: true,
        }]}
      />,
    );

    const edit = button("✎");
    expect(edit?.getAttribute("aria-label")).toBe("Edit answer");
    act(() => edit?.click());
    const textarea = container?.querySelector<HTMLTextAreaElement>('[aria-label="Edit answer text"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")
        ?.set?.call(textarea, "New answer");
      textarea?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button("Save")?.click());

    expect(onEditAnswer).toHaveBeenCalledWith("answer", "New answer");
  });

  it("submits Boolean and validated Integer widget values as native types", () => {
    const onSend = vi.fn();
    render(<ChatApp {...props} expectedAnswerType="bool" onSend={onSend} />);

    act(() => button("Yes")?.click());
    act(() => button("No")?.click());
    expect(onSend.mock.calls).toEqual([[true], [false]]);

    render(<ChatApp {...props} expectedAnswerType="int" onSend={onSend} />);
    const input = container?.querySelector<HTMLInputElement>('[aria-label="Expected Integer answer"] input');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")
        ?.set?.call(input, "3.5");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => button("Submit")?.click());
    expect(input?.checkValidity()).toBe(false);
    expect(onSend).toHaveBeenCalledTimes(2);

    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")
        ?.set?.call(input, "4");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => button("Submit")?.click());
    expect(onSend).toHaveBeenLastCalledWith(4);
  });

  it("keeps edited Boolean answers typed", async () => {
    const onEditAnswer = vi.fn().mockResolvedValue(undefined);
    render(
      <ChatApp
        {...props}
        onEditAnswer={onEditAnswer}
        messages={[{
          id: "boolean-answer",
          role: "user",
          content: "Yes",
          editable: true,
          answerType: "bool",
        }]}
      />,
    );

    act(() => button("✎")?.click());
    expect(container?.querySelector('[aria-label="Edit answer text"]')).toBeNull();
    const widget = container?.querySelector('.dcrChat__message [aria-label="Expected Boolean answer"]');
    expect(widget).not.toBeNull();
    const yes = button("Yes");
    expect(yes?.disabled).toBe(true);
    expect(yes?.getAttribute("aria-pressed")).toBe("true");
    await act(async () => button("No")?.click());

    expect(onEditAnswer).toHaveBeenCalledWith("boolean-answer", false);
    expect(container?.querySelector('.dcrChat__message [aria-label="Expected Boolean answer"]')).toBeNull();
  });

  it("rewinds Integer answers with the number widget", async () => {
    const onEditAnswer = vi.fn().mockResolvedValue(undefined);
    render(
      <ChatApp
        {...props}
        onEditAnswer={onEditAnswer}
        messages={[{
          id: "integer-answer",
          role: "user",
          content: "3",
          editable: true,
          answerType: "int",
        }]}
      />,
    );

    act(() => button("✎")?.click());
    const input = container?.querySelector<HTMLInputElement>(
      '.dcrChat__message [aria-label="Expected Integer answer"] input',
    );
    expect(input?.value).toBe("3");
    expect(button("Save")?.disabled).toBe(true);

    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")
        ?.set?.call(input, "5");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button("Save")?.click());
    expect(onEditAnswer).toHaveBeenCalledWith("integer-answer", 5);

    act(() => button("✎")?.click());
    act(() => button("Cancel")?.click());
    expect(container?.querySelector('.dcrChat__message [aria-label="Expected Integer answer"]')).toBeNull();
    expect(onEditAnswer).toHaveBeenCalledTimes(1);
  });

  it("moves <think> reasoning into the Supporting Content panel", () => {
    render(
      <ChatApp
        {...props}
        messages={[
          { id: "question", role: "user", content: "Am I eligible?" },
          {
            id: "answer",
            role: "assistant",
            content: "<think>The citizen is over 18.\nSo eligible.</think>\n\nYes, you are eligible.",
          },
        ]}
      />,
    );

    const message = container?.querySelector(".dcrChat__message--assistant");
    expect(message?.querySelector(".dcrChat__markdown")?.textContent).toBe("Yes, you are eligible.");
    expect(message?.textContent).not.toContain("over 18");

    const heading = message?.querySelector(".dcrChat__messageHeading");
    const headingButton = heading?.querySelector<HTMLButtonElement>("button");
    expect(headingButton?.classList.contains("dcrChat__supportButton")).toBe(true);
    expect(headingButton?.getAttribute("aria-label")).toBe("Supporting Content");
    expect(headingButton?.querySelector("svg")).not.toBeNull();
    expect(headingButton?.parentElement?.previousElementSibling?.textContent).toBe("Assistant");
    expect(container?.querySelector('[aria-label="Chat controls"] .dcrChat__supportButton')).toBeNull();
    act(() => headingButton?.click());

    const panel = container?.querySelector('[role="tabpanel"]');
    expect(panel?.querySelector("article.dcrChat__thinking h3")?.textContent).toBe("Reasoning");
    expect(panel?.textContent).toContain("The citizen is over 18.");
    expect(headingButton?.getAttribute("aria-pressed")).toBe("true");
  });

  it("shows the heading Supporting Content icon only on answers that have it", () => {
    render(
      <ChatApp
        {...props}
        messages={[
          { id: "q", role: "user", content: "Question" },
          { id: "a", role: "assistant", content: "Plain" },
          { id: "b", role: "assistant", content: "Backed", dcrRole: "Caseworker",
            supportingContent: [{ id: "e", title: "Law", content: "Evidence" }] },
        ]}
      />,
    );
    const buttons = [...(container?.querySelectorAll(".dcrChat__supportButton") ?? [])];
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.closest(".dcrChat__message")?.textContent).toContain("Backed");
    expect(buttons[0]?.parentElement?.previousElementSibling?.textContent).toBe("Caseworker");
  });

  it("formats .json citations and supporting content as a structured tree", () => {
    const excerpt = "{\"case_id\": \"CASE-1\", \"decision_outcome\": \"negativ\", "
      + "\"timeline\": [{\"id\": \"e1\", \"law_paragraphs\": [\"law86\"], \"ok\": true}], \"note\": null, \"summary\": \"Cut mid";
    render(
      <ChatApp
        {...props}
        messages={[{
          id: "answer",
          role: "assistant",
          content: "Similar case found [case.json]",
          supportingContent: [{ id: "s", title: "case.json", content: excerpt, source: "cases/case.json" }],
          citations: [{ id: "c", title: "case.json", source: "cases/case.json", kind: "case", excerpt }],
        }]}
      />,
    );

    act(() => button("[1] case.json")?.click());
    const panel = container?.querySelector('[role="tabpanel"]');
    expect(panel?.querySelector("blockquote")).toBeNull();
    const json = panel?.querySelector(".dcrChat__json");
    expect(json).not.toBeNull();
    const keys = [...(json?.querySelectorAll(":scope > dl > div > dt") ?? [])].map((dt) => dt.textContent);
    expect(keys).toEqual(["case_id", "decision_outcome", "timeline", "note", "summary"]);
    expect(json?.querySelector("details summary")?.textContent).toBe("1 item");
    expect(json?.querySelector(".dcrChat__jsonBoolean")?.textContent).toBe("true");
    expect(json?.querySelector(".dcrChat__jsonNull")?.textContent).toBe("null");
    expect(json?.querySelector(".dcrChat__jsonList--inline li")?.textContent).toBe("law86");
    expect(json?.textContent).toContain("Cut mid");
    expect(json?.querySelector("small")?.textContent).toContain("cut mid-document");

    const supportingTab = [...(container?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])]
      .find((tab) => tab.textContent === "Supporting Content");
    act(() => supportingTab?.click());
    const support = container?.querySelector('[role="tabpanel"] .dcrChat__supportingContent');
    expect(support).not.toBeNull();
    expect(support?.querySelector(".dcrChat__json dl")).not.toBeNull();
    expect(support?.querySelector(".dcrChat__markdown")).toBeNull();
  });

  it("re-indents a .json excerpt that cannot be recovered", () => {
    render(
      <ChatApp
        {...props}
        messages={[{
          id: "answer",
          role: "assistant",
          content: "Case",
          citations: [{ id: "c", title: "c", source: "c.json", kind: "case", excerpt: "{\"a\": 1]" }],
        }]}
      />,
    );
    act(() => button("[1] c")?.click());
    const raw = container?.querySelector('[role="tabpanel"] pre.dcrChat__json--raw');
    expect(raw?.textContent).toBe("{\n  \"a\": 1\n]");
  });

  it("shows a DCR Graph icon on Assistant answers only when a graph panel exists", () => {
    render(
      <ChatApp
        {...props}
        messages={[
          { id: "q", role: "user", content: "Question" },
          { id: "a", role: "assistant", content: "Answer" },
        ]}
      />,
    );
    expect(container?.querySelector(".dcrChat__graphButton")).toBeNull();

    render(
      <ChatApp
        {...props}
        graphPanel={<div>Graph viewer</div>}
        messages={[
          { id: "q", role: "user", content: "Question" },
          { id: "a", role: "assistant", content: "Answer" },
        ]}
      />,
    );
    const graphButtons = [...(container?.querySelectorAll<HTMLButtonElement>(".dcrChat__graphButton") ?? [])];
    expect(graphButtons).toHaveLength(1);
    const graphButton = graphButtons[0];
    expect(graphButton?.closest(".dcrChat__message--assistant")).not.toBeNull();
    expect(graphButton?.getAttribute("aria-label")).toBe("DCR Graph");
    expect(graphButton?.querySelector("svg")).not.toBeNull();
    expect(graphButton?.parentElement?.previousElementSibling?.textContent).toBe("Assistant");

    act(() => graphButton?.click());
    expect(container?.querySelector('[role="tabpanel"]')?.textContent).toContain("Graph viewer");
    expect(graphButton?.getAttribute("aria-pressed")).toBe("true");
  });
});

function render(element: ReactNode): void {
  if (!container) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  act(() => root?.render(element));
}

function button(label: string): HTMLButtonElement | undefined {
  return [...(container?.querySelectorAll("button") ?? [])].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
}

function field(label: string): HTMLInputElement | HTMLSelectElement | undefined {
  const element = [...(container?.querySelectorAll("label") ?? [])].find(
    (candidate) => candidate.textContent?.includes(label),
  );
  return element?.querySelector<HTMLInputElement | HTMLSelectElement>("input, select")
    ?? undefined;
}
