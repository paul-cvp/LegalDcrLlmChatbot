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
  activityRepetitions: DEFAULT_ACTIVITY_REPETITIONS,
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
    expect(field("Use Citizen Information")?.disabled).toBe(false);
    expect(field("Search index")?.disabled).toBe(true);
    expect(field("Suggest follow-up statements")?.disabled).toBe(true);
    expect(field("Retrieve count")?.disabled).toBe(true);
    expect(field("Minimum search score")?.disabled).toBe(true);

    render(<ChatApp {...props} mode="rag" hasCachedCitizenInformation />);
    expect(field("DCR Role")?.disabled).toBe(true);
    expect(field("Automatic Robot executions per activity")?.disabled).toBe(true);
    expect(field("Repeat executed activities")?.disabled).toBe(true);
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
    const actions = [...(message?.querySelectorAll("button") ?? [])];
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
    const textarea = container?.querySelector<HTMLTextAreaElement>('[aria-label="Edit answer text"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")
        ?.set?.call(textarea, "No");
      textarea?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button("Save")?.click());

    expect(onEditAnswer).toHaveBeenCalledWith("boolean-answer", false);
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
