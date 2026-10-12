import type { ChatMessage, SupportingContentItem } from "./types";

export interface ThinkingSplit {
  /** The answer with every reasoning block removed. */
  content: string;
  /** Each reasoning block, in document order. */
  thoughts: string[];
}

const THINK_TAG = /(<\/?think>)/i;
const OPEN_TAG = /^<think>$/i;
const CLOSE_TAG = /^<\/think>$/i;

export function hasThinkingTags(text: string): boolean {
  return THINK_TAG.test(text);
}

/**
 * Separates model reasoning wrapped in `<think>` tags from the visible answer.
 *
 * Handles several blocks, an unterminated block (truncated output) and a bare
 * closing tag with no opening tag, which some models emit when the opening
 * tag was part of the prompt template.
 */
export function splitThinking(text: string): ThinkingSplit {
  if (!hasThinkingTags(text)) return { content: text, thoughts: [] };

  const tokens = text.split(THINK_TAG);
  const firstTag = tokens.find((token) => OPEN_TAG.test(token) || CLOSE_TAG.test(token));
  let thinking = Boolean(firstTag && CLOSE_TAG.test(firstTag));
  const thoughts: string[] = [];
  const visible: string[] = [];

  for (const token of tokens) {
    if (OPEN_TAG.test(token)) {
      thinking = true;
      continue;
    }
    if (CLOSE_TAG.test(token)) {
      thinking = false;
      continue;
    }
    if (thinking) {
      const thought = token.trim();
      if (thought) thoughts.push(thought);
    } else {
      visible.push(token);
    }
  }

  return { content: visible.join("").trim(), thoughts };
}

export function thinkingSupportingContent(
  messageId: string,
  thoughts: readonly string[],
): SupportingContentItem[] {
  return thoughts.map((thought, index) => ({
    id: `${messageId}-thinking-${index}`,
    kind: "thinking",
    title: thoughts.length > 1 ? `Reasoning ${index + 1}` : "Reasoning",
    content: thought,
    source: "Model reasoning",
  }));
}

export function isThinkingItem(item: SupportingContentItem): boolean {
  return item.kind === "thinking";
}

/** Moves `<think>` reasoning out of the message body into its supporting content. */
export function presentMessage(message: ChatMessage): ChatMessage {
  if (!hasThinkingTags(message.content)) return message;
  const { content, thoughts } = splitThinking(message.content);
  if (!thoughts.length) return content === message.content ? message : { ...message, content };
  return {
    ...message,
    content,
    supportingContent: [
      ...thinkingSupportingContent(message.id, thoughts),
      ...(message.supportingContent ?? []),
    ],
  };
}
