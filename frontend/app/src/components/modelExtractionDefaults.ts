import type { ExtractionConfig } from "dcr-engine/src/extraction.ts";

const relationDescription = `**executes**: Focus on actors. Extract a relation of type "executes", if the text describes that this actor (head) is responsible for the event (tail).
**condition**: Focus on events. Extract a relation of type "condition", if one event (head) must be exectued before another (tail) event can be executed (first event is the "condition" for the second event).
**response**: Focus on events. Extract a relation of type "response", if executing one event (head) neccessitates the execution of another (tail) event ("responding" to the first event).
**includes**: Focus on events. Extract a relation of type "includes", if executing one event (head) enables the execution of another (tail) event again, even if it was execluded before.
**excludes**: Focus on events. Extract a relation of type "excludes", if executing one event (head) makes executing another (tail) event impossible, i.e., prevents its execution. Excludes relations can be reflexive, e.g., if one event can only be executed once.`;

const mentionDescription = `**Event**: These are events, preconditions or outcomes relevant to law and regulation. Events can be immaterial, e.g., providing support, help or compensation. Beyond that events can also be inputs, that is data that is relevant to the law (e.g. numbers, strings).
**Actor**: Nouns and pronouns, that describe a person, system, or company that is responsible for executing an event in the process.`;

const dataDescription = `**Variable**: Data that is relevant to the process, e.g., by changing rules or outcomes. Examples are the age of process participants, distances, weights, number of units, etc. Time does not need to be extracted separately and will always be a variable available by default.
**Expression**: Rules that change behaviour and constraints, e.g., if a response is only valid if some variable is below a certain threshold. Such expressions are called Guards. If the expression uses the time variable, they are called Deadlines (for responses) and Timeouts (for conditions). Expressions always shall be extracted in the FEEL notation, deadlines and timeouts use the time period format, e.g., PT2h for a period of 2 hours.`;

export function createDefaultExtractionConfig(): ExtractionConfig {
  return {
    text: "",
    relationDescription,
    mentionDescription,
    dataDescription,
  };
}

