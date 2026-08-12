import {type DataDCR, type Event, type EventMap, type ExecutionRecord} from "./types";
import mentionPrompt from "./prompts/mentions";
import relationsPrompt from "./prompts/relations";
import dataPrompt from "./prompts/guards";

export type Variable = {
    name: string;
    type: string;
}

export type AllowedRole = "Citizen" | "Caseworker" | "Robot";

export type Expression = {
    text: string;
    boundToRelation: number;
}

export type Mention = {
    text: string;
    type: string;
    sentence: number;
    role?: AllowedRole;
};

export type Entity = {
    representativeIndex: number;
    mentionIndices: number[];
}

export type Relation = {
    type: string;
    headMentionIndex: number;
    tailMentionIndex: number;
};

export type ProcessDescription = {
    text: string;
    sentences: string[];
    mentions: Mention[];
    entities: Entity[];
    relations: Relation[];
    variables: Variable[];
    expressions: Expression[];
}

export type ExtractionConfig = {
    text: string;
    mentionDescription: string;
    relationDescription: string;
    dataDescription: string;
}

export type ExtractionResult = {
    graph: DataDCR;
    doc: ProcessDescription;
}

export type LLMRequester = (input: string) => Promise<string>;

export default async function extractGraph(
    config: ExtractionConfig,
    llmRequester: LLMRequester,
): Promise<ExtractionResult> {
    const doc = preprocessText(config.text);
    doc.mentions = await extractEntityMentions(doc, config.mentionDescription, llmRequester);
    doc.relations = await extractRelations(doc, config.relationDescription, llmRequester);
    const {
        variables,
        expressions
    } = await extractDataAndExpressions(doc, config.dataDescription, llmRequester);
    doc.variables = variables;
    doc.expressions = expressions;

    return createExtractionResult(doc);
}

export function createExtractionResult(doc: ProcessDescription): ExtractionResult {
    const graph: DataDCR = {
        events: new Set<Event>(),
        conditionsFor: {},
        excludesTo: {},
        includesTo: {},
        milestonesFor: {},
        responseTo: {},
        marking: {
            executed: new Map<Event, ExecutionRecord>(),
            pending: new Map<Event, Date | undefined>(),
            included: new Set<Event>(),
        },
        data: {},
        expressions: {},
        title: createProcessTitle(doc.text),
        description: doc.text,
        eventMetadata: {},
    };

    const roles = new Map<string, AllowedRole>();
    for (const relation of doc.relations) {
        if (relation.type.toLowerCase() !== "executes") continue;
        const actor = doc.mentions[relation.headMentionIndex];
        const event = doc.mentions[relation.tailMentionIndex];
        if (!actor || !event || actor.type.toLowerCase() !== "actor") continue;
        // The first explicit executor is authoritative when extraction is ambiguous.
        if (!roles.has(event.text)) roles.set(event.text, normalizeRole(actor));
    }

    for (const m of doc.mentions) {
        if (m.type.toLowerCase() !== "event") continue;
        graph.events.add(m.text);
        graph.marking.included.add(m.text);
        const sentenceActors = doc.mentions
            .filter(candidate => candidate.type.toLowerCase() === "actor" && candidate.sentence === m.sentence);
        const role = roles.get(m.text) ?? normalizeRole(sentenceActors[0]);
        const sourceDescription = doc.sentences[m.sentence]?.trim() || m.text;
        graph.eventMetadata![m.text] = {
            label: m.text,
            role,
            description: sourceDescription,
        };
    }

    graph.data = {};
    const availableVariables = [...doc.variables];
    const usedVariableNames = new Set(doc.variables.map(variable => variable.name));
    for (const event of graph.events) {
        if (graph.eventMetadata![event].role !== "Citizen") continue;
        const matchIndex = findMatchingVariable(event, availableVariables);
        const variable = matchIndex >= 0
            ? availableVariables.splice(matchIndex, 1)[0]
            : createInputVariable(event, usedVariableNames);
        graph.data[event] = variable;
    }

    for (const v of availableVariables) {
        graph.events.add(v.name);
        graph.data[v.name] = {
            name: v.name,
            type: v.type
        };
        graph.eventMetadata![v.name] = {
            label: v.name,
            description: `Data variable: ${v.name}`,
            role: "Robot",
        };
    }

    for (const r of doc.relations) {
        const head = doc.mentions[r.headMentionIndex];
        const tail = doc.mentions[r.tailMentionIndex];
        switch (r.type.toLowerCase()) {
            case "executes": {
                break;
            }
            case "condition": {
                addToEventMap(graph.conditionsFor, tail.text, head.text);
                break;
            }
            case "response": {
                addToEventMap(graph.responseTo, head.text, tail.text);
                break;
            }
            case "excludes": {
                addToEventMap(graph.excludesTo, head.text, tail.text);
                break;
            }
            case "includes": {
                addToEventMap(graph.includesTo, head.text, tail.text);
                break;
            }
        }
    }

    graph.expressions = {};
    for (const e of doc.expressions) {
        const r = doc.relations[e.boundToRelation];
        const head = doc.mentions[r.headMentionIndex];
        const tail = doc.mentions[r.tailMentionIndex];
        if (graph.expressions[head.text] === undefined) graph.expressions[head.text] = {};
        const constraint = graph.expressions[head.text][tail.text] ?? {};
        if (isDuration(e.text) && ["condition", "response"].includes(r.type.toLowerCase())) {
            constraint.time = e.text.toUpperCase();
        } else if (!isDuration(e.text)) {
            constraint.text = constraint.text ? `(${constraint.text}) and (${e.text})` : e.text;
        }
        graph.expressions[head.text][tail.text] = constraint;
    }

    return {graph, doc};
}

export function normalizeRole(actor?: Pick<Mention, "text" | "role">): AllowedRole {
    const declared = actor?.role?.toLowerCase();
    if (declared === "citizen") return "Citizen";
    if (declared === "robot") return "Robot";
    if (declared === "caseworker") return "Caseworker";

    const name = actor?.text ?? "";
    if (/\b(citizen|applicant|claimant|resident|passenger|parent|guardian|patient|customer|user)\b/i.test(name)) {
        return "Citizen";
    }
    if (/\b(robot|system|software|platform|service|algorithm|automated|automation)\b/i.test(name)) {
        return "Robot";
    }
    return "Caseworker";
}

export function createProcessTitle(text: string): string {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (!normalized) return "Generated Process";

    const firstSentence = Array.from(
        new Intl.Segmenter("en", {granularity: "sentence"}).segment(normalized)
    )[0]?.segment.trim() ?? normalized;
    const words = firstSentence.replace(/[.!?;:,]+$/, "").split(" ");
    const title = words.slice(0, 10).join(" ");
    return words.length > 10 ? `${title}…` : title;
}

function findMatchingVariable(event: string, variables: Variable[]): number {
    const eventTokens = normalizedTokens(event);
    const candidates = variables
        .map((variable, index) => ({variable, index, tokens: normalizedTokens(variable.name)}))
        .filter(({variable, tokens}) =>
            ["Bool", "Int"].includes(variable.type)
            && tokens.length > 0
            && (containsTokens(eventTokens, tokens) || containsTokens(tokens, eventTokens))
        );
    return candidates.length === 1 ? candidates[0].index : -1;
}

function normalizedTokens(value: string): string[] {
    return value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

function containsTokens(container: string[], contained: string[]): boolean {
    const values = new Set(container);
    return contained.every(token => values.has(token));
}

function createInputVariable(event: string, usedNames: Set<string>): Variable {
    const base = `${normalizedTokens(event).join("_") || "citizen"}_input`;
    let name = base;
    let suffix = 2;
    while (usedNames.has(name)) name = `${base}_${suffix++}`;
    usedNames.add(name);
    return {name, type: "String"};
}

const isDuration = (value: string) =>
    /^P(?=\d|T\d)(?:\d+Y)?(?:\d+M)?(?:\d+W)?(?:\d+D)?(?:T(?=\d)(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?$/i.test(value.trim())
    && !["P", "PT"].includes(value.trim().toUpperCase());

function addToEventMap(eventMap: EventMap, source: string, target: string) {
    if (!(source in eventMap)) {
        eventMap[source] = new Set<Event>();
    }
    eventMap[source].add(target);
}

function preprocessText(text: string): ProcessDescription {
    const processed: ProcessDescription = {
        text: text,
        sentences: [],
        mentions: [],
        entities: [],
        relations: [],
        variables: [],
        expressions: [],
    };

    processed.sentences = segmentText(text);

    return processed;
}

function segmentText(text: string): string[] {
    const segmenter = new Intl.Segmenter('en', {granularity: 'sentence'});
    return Array.from(segmenter.segment(text)).map((segment) => segment.segment);
}

interface DataExtractionResult {
    variables: Variable[];
    expressions: Expression[];
}

export async function extractDataAndExpressions(
    doc: ProcessDescription,
    description: string,
    llmRequester: LLMRequester,
): Promise<DataExtractionResult> {
    const taggedSentences = tagMentions(doc.sentences, doc.mentions);
    const relations = doc.relations.map((r, i) => `${i}\t${r.type}\t${r.headMentionIndex}\t${r.tailMentionIndex}`);
    let prompt = dataPrompt;

    prompt = prompt.replaceAll("{{text}}", taggedSentences.join('\n'));
    prompt = prompt.replaceAll("{{relations}}", relations.join('\n'));
    prompt = prompt.replaceAll("{{description}}", description);

    const result = await llmRequester(prompt);

    const variables: Variable[] = [];
    const expressions: Expression[] = [];
    for (const line of result.split("\n")) {
        const [first, second] = line.split("\t").map(part => part?.trim());
        if (!first || !second) continue;
        const relationIndex = Number(first);
        if (Number.isInteger(relationIndex)) {
            if (doc.relations[relationIndex]) expressions.push({text: second, boundToRelation: relationIndex});
            continue;
        }
        const type = second.toLowerCase() === "number" ? "Int"
            : second.toLowerCase() === "boolean" ? "Bool"
            : second;
        variables.push({name: first, type});
    }

    return {expressions, variables}
}

export async function extractRelations(
    doc: ProcessDescription,
    relationDescription: string,
    llmRequester: LLMRequester,
): Promise<Relation[]> {
    const taggedSentences = tagMentions(doc.sentences, doc.mentions);
    let prompt = relationsPrompt;
    prompt = prompt.replaceAll("{{text}}", taggedSentences.join('\n'));
    prompt = prompt.replaceAll("{{description}}", relationDescription);

    const result = await llmRequester(prompt);

    const relations: Relation[] = [];
    for (const rawRelation of result.trim().split("\n")) {
        const [relationType, head, tail] = rawRelation.split("\t");
        relations.push({
            type: relationType,
            headMentionIndex: Number(head),
            tailMentionIndex: Number(tail),
        });
    }

    return relations;
}

export async function extractEntityMentions(
    doc: ProcessDescription,
    mentionDescription: string,
    llmRequester: LLMRequester,
): Promise<Mention[]> {
    let text = "";
    let i = 0;
    for (const s of doc.sentences) {
        text += `${i}: ${s.trim()}\n`;
        i++;
    }

    const mentions: Mention[] = [];

    let prompt = mentionPrompt;
    prompt = prompt.replaceAll("{{text}}", text);
    prompt = prompt.replaceAll("{{description}}", mentionDescription);

    const result = await llmRequester(prompt);

    for (const rawMention of result.trim().split("\n")) {
        const [mentionText, mentionType, mentionSentenceStr, mentionRole] = rawMention.trim().split("\t");
        const mentionSentence = Number(mentionSentenceStr);

        if (!doc.sentences[mentionSentence]?.includes(mentionText)) {
            console.log(`Ignoring '${mentionText}', which is not in the referenced sentence ${mentionSentence} ('${doc.sentences[mentionSentence]}').`);
            continue;
        }

        const mention: Mention = {
            text: mentionText,
            type: mentionType,
            sentence: mentionSentence,
            role: mentionType.toLowerCase() === "actor"
                ? normalizeRole({text: mentionText, role: mentionRole as AllowedRole})
                : undefined,
        }

        mentions.push(mention);
    }
    return mentions;
}

export function tagMentions(
    sentences: string[],
    mentions: Mention[]
): string[] {
    // Group mentions by sentence index
    const mentionsBySentence: Record<number, (Mention & { index: number })[]> =
        {};

    mentions.forEach((m, index) => {
        if (!mentionsBySentence[m.sentence]) {
            mentionsBySentence[m.sentence] = [];
        }
        mentionsBySentence[m.sentence].push({...m, index});
    });

    return sentences.map((sentence, sentenceIndex) => {
        const sentenceMentions = mentionsBySentence[sentenceIndex];
        if (!sentenceMentions || sentenceMentions.length === 0) {
            return sentence;
        }

        // Sort by position in sentence (first occurrence)
        const sorted = sentenceMentions
            .map((m) => {
                const start = sentence.indexOf(m.text);
                if (start === -1) return null;
                return {...m, start, end: start + m.text.length};
            })
            .filter((m): m is NonNullable<typeof m> => m !== null)
            .sort((a, b) => b.start - a.start); // IMPORTANT: reverse order

        let result = sentence;

        for (const m of sorted) {
            const before = result.slice(0, m.start);
            const match = result.slice(m.start, m.end);
            const after = result.slice(m.end);

            const tagged = `<${m.type} id=${m.index}>${match}</${m.type}>`;
            result = before + tagged + after;
        }

        return result;
    });
}
