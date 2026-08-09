import { ChatAppRequest, ChatAppResponse, Config } from "./models";

class DummyApi {
    private readonly encoder = new TextEncoder();

    getConfig(): Promise<Config> {
        return Promise.resolve({
            defaultReasoningEffort: "",
            reasoningEffortOptions: [],
            defaultRetrievalReasoningEffort: "minimal",
            showMultimodalOptions: false,
            showSemanticRankerOption: false,
            showQueryRewritingOption: false,
            showReasoningEffortOption: false,
            streamingEnabled: true,
            showVectorOption: false,
            showLanguagePicker: true,
            showSpeechInput: false,
            showSpeechOutputBrowser: true,
            showChatHistoryBrowser: true,
            showAgenticRetrievalOption: false,
            ragSearchTextEmbeddings: false,
            ragSearchImageEmbeddings: false,
            ragSendTextSources: false,
            ragSendImageSources: false,
            webSourceEnabled: false,
            sharepointSourceEnabled: false
        });
    }

    async chat(request: ChatAppRequest, shouldStream: boolean, signal?: AbortSignal): Promise<Response> {
        const question = [...request.messages].reverse().find(message => message.role === "user")?.content ?? "";
        const sessionState = request.session_state || crypto.randomUUID();
        const response = this.createResponse(`Dummy response: ${question}`, sessionState);

        if (!shouldStream) {
            return Response.json(response);
        }

        return new Response(this.createStream(response, signal), {
            headers: { "Content-Type": "application/x-ndjson" }
        });
    }

    private createResponse(outputText: string, sessionState: string): ChatAppResponse {
        return {
            output_text: outputText,
            context: {
                data_points: { text: [], images: [], citations: [] },
                thoughts: [],
                followup_questions: null
            },
            session_state: sessionState
        };
    }

    private createStream(response: ChatAppResponse, signal?: AbortSignal): ReadableStream<Uint8Array> {
        return new ReadableStream({
            start: async controller => {
                let closed = false;
                const abort = () => {
                    if (!closed) {
                        closed = true;
                        controller.error(new DOMException("The request was aborted.", "AbortError"));
                    }
                };
                signal?.addEventListener("abort", abort, { once: true });

                try {
                    this.enqueue(controller, {
                        type: "response.context",
                        context: response.context,
                        session_state: response.session_state
                    });
                    for (const delta of response.output_text.match(/\S+\s*/g) ?? []) {
                        if (signal?.aborted) return abort();
                        await new Promise(resolve => setTimeout(resolve, 40));
                        if (signal?.aborted) return abort();
                        this.enqueue(controller, { type: "response.output_text.delta", delta });
                    }
                    closed = true;
                    controller.close();
                } finally {
                    signal?.removeEventListener("abort", abort);
                }
            }
        });
    }

    private enqueue(controller: ReadableStreamDefaultController<Uint8Array>, event: object): void {
        controller.enqueue(this.encoder.encode(`${JSON.stringify(event)}\n`));
    }
}

const dummyApi = new DummyApi();

export const configApi = () => dummyApi.getConfig();
export const chatApi = (request: ChatAppRequest, shouldStream: boolean, signal?: AbortSignal) => dummyApi.chat(request, shouldStream, signal);
export const getCitationFilePath = (citation: string) => citation;
export const fetchResource = (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init);
