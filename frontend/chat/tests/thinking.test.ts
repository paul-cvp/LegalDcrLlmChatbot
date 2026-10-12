import { describe, expect, it } from "vitest";

import { presentMessage, splitThinking } from "../src";

describe("splitThinking", () => {
  it("leaves text without think tags untouched", () => {
    expect(splitThinking("Plain answer")).toEqual({ content: "Plain answer", thoughts: [] });
  });

  it("separates one reasoning block from the answer", () => {
    expect(splitThinking("<think>\nPonder.\n</think>\n\nAnswer.")).toEqual({
      content: "Answer.",
      thoughts: ["Ponder."],
    });
  });

  it("collects several blocks in order and keeps surrounding text", () => {
    expect(splitThinking("Intro <think>one</think> middle <THINK>two</THINK> end")).toEqual({
      content: "Intro  middle  end",
      thoughts: ["one", "two"],
    });
  });

  it("treats an unterminated block as reasoning", () => {
    expect(splitThinking("Short.<think>cut off mid")).toEqual({
      content: "Short.",
      thoughts: ["cut off mid"],
    });
  });

  it("treats text before a bare closing tag as reasoning", () => {
    expect(splitThinking("hidden reasoning</think>Visible answer")).toEqual({
      content: "Visible answer",
      thoughts: ["hidden reasoning"],
    });
  });

  it("drops empty blocks", () => {
    expect(splitThinking("<think></think>Answer")).toEqual({ content: "Answer", thoughts: [] });
  });
});

describe("presentMessage", () => {
  it("returns the same object when there is nothing to extract", () => {
    const message = { id: "m", role: "assistant" as const, content: "Answer" };
    expect(presentMessage(message)).toBe(message);
  });

  it("prepends reasoning to existing supporting content", () => {
    const presented = presentMessage({
      id: "m",
      role: "assistant",
      content: "<think>why</think>Answer [law.pdf]",
      supportingContent: [{ id: "e", title: "Law", content: "Evidence" }],
    });
    expect(presented.content).toBe("Answer [law.pdf]");
    expect(presented.supportingContent?.map((item) => [item.kind, item.title, item.content])).toEqual([
      ["thinking", "Reasoning", "why"],
      [undefined, "Law", "Evidence"],
    ]);
  });

  it("numbers several reasoning blocks", () => {
    const presented = presentMessage({
      id: "m",
      role: "assistant",
      content: "<think>a</think>x<think>b</think>",
    });
    expect(presented.supportingContent?.map((item) => item.title)).toEqual(["Reasoning 1", "Reasoning 2"]);
  });
});
