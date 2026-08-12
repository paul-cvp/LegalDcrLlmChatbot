interface ActivityQuestionsResponse {
  questions: Record<string, string>;
}

interface APIErrorResponse {
  detail?: unknown;
}

export interface ActivityQuestionContext {
  graphXml: string;
  eventId: string;
  label: string;
  role: string;
  description: string;
}

export async function generateActivityQuestion(
  context: ActivityQuestionContext,
): Promise<string> {
  const response = await fetch("/api/documents-to-dcr/activity-question", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      graph_xml: context.graphXml,
      event_id: context.eventId,
      label: context.label,
      role: context.role,
      description: context.description,
    }),
  });

  if (!response.ok) {
    throw new Error(await errorMessage(response, "Question generation failed"));
  }
  return ((await response.json()) as { text: string }).text;
}

export async function generateActivityQuestions(
  graphXml: string,
): Promise<Record<string, string>> {
  const response = await fetch("/api/documents-to-dcr/activity-questions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ graph_xml: graphXml }),
  });

  if (!response.ok) {
    throw new Error(await errorMessage(response, "Activity question generation failed"));
  }

  return ((await response.json()) as ActivityQuestionsResponse).questions;
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as APIErrorResponse;
    if (typeof body.detail === "string") return body.detail;
  } catch {
    // Keep the status-based fallback for non-JSON responses.
  }
  return `${fallback} (${response.status}).`;
}

export function applyActivityQuestions(
  graphXml: string,
  questions: Record<string, string>,
): string {
  const document = new DOMParser().parseFromString(graphXml, "application/xml");
  if (document.querySelector("parsererror")) {
    throw new Error("The generated process XML could not be finalized.");
  }

  const events = [...document.getElementsByTagName("*")]
    .filter((element) => element.localName === "event");
  for (const event of events) {
    const id = event.getAttribute("id");
    if (id && Object.hasOwn(questions, id)) {
      event.setAttribute("description", questions[id]);
    }
  }
  return new XMLSerializer().serializeToString(document);
}
