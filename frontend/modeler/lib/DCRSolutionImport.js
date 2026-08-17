import xml2js, { parseStringPromise } from "xml2js";

import convertDCRPortalXML from "./DCRPortalConverter";

const TYPE_MAP = new Map([
  ["bool", "Bool"],
  ["boolean", "Bool"],
  ["int", "Int"],
  ["integer", "Int"],
  ["number", "Int"],
  ["string", "String"],
  ["text", "String"],
]);

const ELEMENT_PREFIXES = new Map([
  ["dcr:event", "Event"],
  ["dcr:nesting", "Nesting"],
  ["dcr:subProcess", "SubProcess"],
]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function canonicalType(type) {
  return TYPE_MAP.get(String(type || "").toLowerCase());
}

function prefixedId(id, prefix) {
  return id.startsWith(`${prefix}_`) ? id : `${prefix}_${id}`;
}

function tokenizeExpression(expression) {
  const pattern = /\s+|>=|<=|!=|==|[()=<>+\-*/,]|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\d+(?:\.\d+)?|[A-Za-z_][A-Za-z0-9_]*|./gy;
  const tokens = [];
  let match;
  while ((match = pattern.exec(expression)) !== null) {
    if (!/^\s+$/.test(match[0])) tokens.push(match[0]);
  }
  return tokens;
}

function parseComputation(expression, eventIds, context) {
  const tokens = tokenizeExpression(expression);
  let position = 0;
  const peek = () => tokens[position];
  const consume = () => tokens[position++];

  const computationReference = (identifier) => {
    if (identifier === context.source) return { tuple: ["source", "data"] };
    if (identifier === context.target) return { tuple: ["target", "data"] };
    if (eventIds.has(identifier)) return { tuple: [identifier, "data"] };
    throw new Error(`Expression references unknown event “${identifier}”.`);
  };

  const convertToken = (token) => {
    const keyword = token.toLowerCase();
    if (keyword === "true" || keyword === "false") return keyword === "true";
    if (keyword === "null") return "type(None)()";
    if (["and", "or", "not"].includes(keyword)) return keyword;
    if (token === "=") return "==";
    if (/^\d+(?:\.\d+)?$/.test(token)) return Number(token);
    if (/^["']/.test(token)) return token;
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(token)) {
      return computationReference(token);
    }
    if ([">=", "<=", "!=", "==", ">", "<", "+", "-", "*", "/", ","].includes(token)) {
      return token;
    }
    throw new Error(`Unsupported expression token “${token}”.`);
  };

  const parseGroup = () => {
    if (consume() !== "(") throw new Error("Expected an opening parenthesis.");
    const result = parseSequence(new Set(), true);
    if (consume() !== ")") throw new Error("Expected a closing parenthesis.");
    return ["(", ...result, ")"];
  };

  const parseOperand = (stopKeyword) => {
    if (peek() === "(") return parseGroup();
    return parseSequence(new Set([stopKeyword]), false);
  };

  const parseConditional = () => {
    consume(); // If
    const condition = parseOperand("then");
    if (String(consume()).toLowerCase() !== "then") {
      throw new Error("Conditional expression is missing THEN.");
    }
    const whenTrue = parseOperand("else");
    if (String(consume()).toLowerCase() !== "else") {
      throw new Error("Conditional expression is missing ELSE.");
    }
    const whenFalse = peek() === "(" ? parseGroup() : parseSequence(new Set(), false);
    // Python list indexing expresses a scalar conditional without backend changes.
    return ["[", ...whenFalse, ",", ...whenTrue, "]", "[", ...condition, "]"];
  };

  function parseSequence(stopKeywords, stopAtParenthesis) {
    const result = [];
    while (position < tokens.length) {
      const token = peek();
      const keyword = token.toLowerCase();
      if (stopKeywords.has(keyword) || (stopAtParenthesis && token === ")")) break;
      if (keyword === "if") result.push(...parseConditional());
      else if (token === "(") result.push(...parseGroup());
      else if (token === ")" || keyword === "then" || keyword === "else") {
        break;
      } else result.push(convertToken(consume()));
    }
    return result;
  }

  const computation = parseSequence(new Set(), false);
  if (position !== tokens.length) {
    throw new Error(`Unexpected expression token “${peek()}”.`);
  }
  return JSON.stringify(computation);
}

function collectEvent(event, eventDataById, layoutById, eventExpressionById, eventIds, visitGraph) {
  if (!event || typeof event !== "object") return;

  const id = event.$?.id;
  if (id) {
    eventIds.add(id);
    if (event.$?.computation) eventExpressionById.set(id, event.$.computation);
  }
  event.custom ||= [{}];
  if (event.custom.length === 0 || typeof event.custom[0] !== "object") {
    event.custom = [{}];
  }

  const custom = event.custom[0];
  custom.eventData ||= [""];

  const visualization = asArray(custom.visualization)[0];
  const location = asArray(visualization?.location)[0]?.$;
  const size = asArray(visualization?.size)[0]?.$;
  if (id && location && size) {
    layoutById.set(id, {
      x: String(location.xLoc),
      y: String(location.yLoc),
      width: String(size.width),
      height: String(size.height),
    });
  }

  for (const eventData of custom.eventData) {
    if (!eventData || typeof eventData !== "object") continue;
    const dataType = asArray(eventData.dataType)[0];
    const solutionType = dataType?.$?.format || dataType?._ || dataType;
    const name = String(eventData.$?.name || id || "").trim();
    const type = canonicalType(eventData.$?.type || solutionType);
    if (!eventData.$ && !type) continue;
    if (!name && !eventData.$?.type) continue;
    if (!id || !name || !type) {
      throw new Error(
        "Named eventData must include an event id, a variable name, and a supported type.",
      );
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw new Error(
        `Event data variable “${name}” must be a valid identifier.`,
      );
    }
    eventDataById.set(id, {
      name,
      type,
      default: eventData.$?.default,
    });
  }

  for (const child of asArray(event.event)) {
    collectEvent(child, eventDataById, layoutById, eventExpressionById, eventIds, visitGraph);
  }
  for (const template of asArray(event.template)) {
    for (const graph of asArray(template.dcrgraph)) visitGraph(graph);
  }
}

function collectRelations(constraints, relationLayoutById, relationExpressionById) {
  if (!constraints || typeof constraints !== "object") return;
  for (const relationGroup of Object.values(constraints)) {
    for (const group of asArray(relationGroup)) {
      if (!group || typeof group !== "object") continue;
      for (const [sourceType, relations] of Object.entries(group)) {
        const type = sourceType === "templateSpawn"
          ? "spawn"
          : sourceType === "coresponce"
            ? "noresponse"
            : sourceType === "update"
              ? "setValue"
              : sourceType;
        for (const relation of asArray(relations)) {
          const source = relation?.$?.sourceId;
          const target = relation?.$?.targetId;
          if (source && target && relation?.$?.expressionId) {
            relationExpressionById.set(`${source}${target}${type}`, relation.$.expressionId);
          }
          const waypoints = asArray(
            asArray(relation?.custom)[0]?.waypoints,
          )[0]?.waypoint;
          if (!source || !target || !Array.isArray(waypoints)) continue;
          relationLayoutById.set(
            `${source}${target}${type}`,
            waypoints.map((waypoint) => ({
              $: {
                x: String(waypoint.$.x),
                y: String(waypoint.$.y),
              },
            })),
          );
        }
      }
    }
  }
}

function collectGraph(graph, state) {
  const visitGraph = (nestedGraph) =>
    collectGraph(nestedGraph, state);
  for (const specification of asArray(graph?.specification)) {
    for (const constraints of asArray(specification.constraints)) {
      collectRelations(constraints, state.relationLayoutById, state.relationExpressionById);
    }
    for (const resources of asArray(specification.resources)) {
      for (const events of asArray(resources.events)) {
        for (const event of asArray(events.event)) {
          collectEvent(
            event,
            state.eventDataById,
            state.layoutById,
            state.eventExpressionById,
            state.eventIds,
            visitGraph,
          );
        }
      }
      for (const labels of asArray(resources.labelMappings)) {
        for (const mapping of asArray(labels.labelMapping)) {
          if (mapping?.$?.eventId && mapping?.$?.labelId) {
            state.labelById.set(mapping.$.eventId, mapping.$.labelId);
          }
        }
      }
      for (const expressions of asArray(resources.expressions)) {
        for (const expression of asArray(expressions.expression)) {
          if (expression?.$?.id && expression?.$?.value !== undefined) {
            state.expressionById.set(expression.$.id, expression.$.value);
          }
        }
      }
      for (const subProcesses of asArray(resources.subProcesses)) {
        for (const subProcess of asArray(subProcesses.subProcess)) {
          if (subProcess?.$?.id) state.eventIds.add(subProcess.$.id);
          for (const nestedGraph of asArray(subProcess.dcrgraph)) {
            visitGraph(nestedGraph);
          }
        }
      }
    }
  }
}

function applyEditorLayout(definitions, layoutById, relationLayoutById) {
  const rootBoard = asArray(definitions?.["dcrDi:dcrRootBoard"])[0];
  const plane = asArray(rootBoard?.["dcrDi:dcrPlane"])[0];
  if (!plane) return;

  for (const shape of asArray(plane["dcrDi:dcrShape"])) {
    const bounds = layoutById.get(shape?.$?.boardElement);
    if (!bounds) continue;
    shape["dc:Bounds"] = [{ $: bounds }];
  }

  for (const relation of asArray(plane["dcrDi:relation"])) {
    const waypoints = relationLayoutById.get(relation?.$?.boardElement);
    if (waypoints) relation["dcrDi:waypoint"] = waypoints;
  }
}

function collectEditorIds(element, elementIds, relationIds) {
  for (const [key, prefix] of ELEMENT_PREFIXES) {
    for (const child of asArray(element[key])) {
      if (child?.$?.id) {
        elementIds.set(child.$.id, prefixedId(child.$.id, prefix));
      }
      collectEditorIds(child, elementIds, relationIds);
    }
  }
  for (const relation of asArray(element["dcr:relation"])) {
    if (relation?.$?.id) {
      relationIds.set(relation.$.id, prefixedId(relation.$.id, "Relation"));
    }
  }
}

function rewriteComputation(value, elementIds) {
  if (!value) return value;
  const computation = JSON.parse(value);
  for (const token of computation) {
    const reference = token?.tuple;
    if (Array.isArray(reference) && elementIds.has(reference[0])) {
      reference[0] = elementIds.get(reference[0]);
    }
  }
  return JSON.stringify(computation);
}

function normalizeEditorIds(definitions, graph) {
  const elementIds = new Map();
  const relationIds = new Map();
  collectEditorIds(graph, elementIds, relationIds);

  const rewriteElement = (element) => {
    if (!element || typeof element !== "object") return;
    if (elementIds.has(element.$?.id)) element.$.id = elementIds.get(element.$.id);
    if (element.$?.computation) {
      element.$.computation = rewriteComputation(element.$.computation, elementIds);
    }

    for (const relation of asArray(element["dcr:relation"])) {
      relation.$.id = relationIds.get(relation.$.id);
      relation.$.sourceRef = elementIds.get(relation.$.sourceRef);
      relation.$.targetRef = elementIds.get(relation.$.targetRef);
      for (const attribute of ["guardComputation", "valueComputation"]) {
        if (relation.$[attribute]) {
          relation.$[attribute] = rewriteComputation(relation.$[attribute], elementIds);
        }
      }
    }
    for (const key of ELEMENT_PREFIXES.keys()) {
      for (const child of asArray(element[key])) rewriteElement(child);
    }
  };
  rewriteElement(graph);

  const plane = asArray(
    asArray(definitions?.["dcrDi:dcrRootBoard"])[0]?.["dcrDi:dcrPlane"],
  )[0];
  for (const shape of asArray(plane?.["dcrDi:dcrShape"])) {
    const boardElement = elementIds.get(shape?.$?.boardElement);
    if (!boardElement) continue;
    shape.$.boardElement = boardElement;
    shape.$.id = `${boardElement}_di`;
  }
  for (const relation of asArray(plane?.["dcrDi:relation"])) {
    const boardElement = relationIds.get(relation?.$?.boardElement);
    if (!boardElement) continue;
    relation.$.boardElement = boardElement;
    relation.$.id = `${boardElement}_di`;
  }
}

function expressionValue(expressionId, state) {
  const expression = state.expressionById.get(expressionId);
  if (expression === undefined) {
    throw new Error(`Expression “${expressionId}” is not defined.`);
  }
  return expression;
}

function addEditorMetadata(element, state) {
  if (!element || typeof element !== "object") return;

  const id = element.$?.id;
  element.$ ||= {};
  if (state.labelById.has(id)) element.$.label = state.labelById.get(id);
  element.$.description = "";

  const expressionId = state.eventExpressionById.get(id);
  if (expressionId) {
    element.$.computation = parseComputation(
      expressionValue(expressionId, state),
      state.eventIds,
      { source: id },
    );
  }

  const eventData = state.eventDataById.get(id);
  if (eventData) {
    const attributes = { name: eventData.name, type: eventData.type };
    if (eventData.default !== undefined && eventData.default !== "") {
      attributes.default = String(eventData.default);
    }
    element["dcr:eventData"] = [{ $: attributes }];
  }

  for (const key of ["dcr:event", "dcr:nesting", "dcr:subProcess"]) {
    for (const child of asArray(element[key])) {
      addEditorMetadata(child, state);
    }
  }

  for (const relation of asArray(element["dcr:relation"])) {
    const expressionId = state.relationExpressionById.get(relation?.$?.id);
    if (!expressionId) continue;
    const expression = expressionValue(expressionId, state);
    const isSetValue = relation.$.type === "setValue";
    // The modeler uses the raw expression; the backend uses its computation.
    relation.$[isSetValue ? "value" : "guard"] = expression;
    relation.$[isSetValue ? "valueComputation" : "guardComputation"] =
      parseComputation(
        expression,
        state.eventIds,
        { source: relation.$.sourceRef, target: relation.$.targetRef },
      );
  }
}

export default async function convertDCRSolutionForStorage(xml) {
  let source;
  try {
    source = await parseStringPromise(xml);
  } catch {
    throw new Error("The selected file is not well-formed XML.");
  }

  if (!source?.dcrgraph) {
    throw new Error("The selected file is not a DCR Solutions XML graph.");
  }

  const state = {
    eventDataById: new Map(),
    layoutById: new Map(),
    relationLayoutById: new Map(),
    labelById: new Map(),
    expressionById: new Map(),
    eventExpressionById: new Map(),
    relationExpressionById: new Map(),
    eventIds: new Set(),
  };
  collectGraph(source.dcrgraph, state);

  const normalizedSource = new xml2js.Builder().buildObject(source);
  const converted = await convertDCRPortalXML(normalizedSource);
  if (!converted) {
    throw new Error("The DCR Solutions XML could not be converted.");
  }

  let editor;
  try {
    editor = await parseStringPromise(converted);
  } catch {
    throw new Error("The converted graph is not valid editor XML.");
  }

  const definitions = editor?.["dcr:definitions"];
  const graph = asArray(definitions?.["dcr:dcrGraph"])[0];
  if (!graph) {
    throw new Error("The converted graph does not contain an editor graph.");
  }

  addEditorMetadata(graph, state);
  applyEditorLayout(definitions, state.layoutById, state.relationLayoutById);
  normalizeEditorIds(definitions, graph);
  return new xml2js.Builder().buildObject(editor);
}
