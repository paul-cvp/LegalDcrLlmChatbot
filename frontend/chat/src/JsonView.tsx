import { useMemo } from "react";

import { formatJsonLoosely, parseJsonExcerpt, type JsonValue } from "./json";

const OPEN_DEPTH = 2;

/** Renders a JSON excerpt of any shape as a readable tree, falling back to re-indented text. */
export function JsonExcerpt({ text }: { text: string }) {
  const parsed = useMemo(() => parseJsonExcerpt(text), [text]);
  if (!parsed) {
    return <pre className="dcrChat__json dcrChat__json--raw">{formatJsonLoosely(text)}</pre>;
  }
  return (
    <div className="dcrChat__json">
      {parsed.repaired && (
        <small>This excerpt was cut mid-document; showing the recoverable part.</small>
      )}
      <JsonNode value={parsed.value} depth={0} />
    </div>
  );
}

function JsonNode({ value, depth }: { value: JsonValue; depth: number }) {
  if (value === null) return <span className="dcrChat__jsonNull">null</span>;
  if (typeof value === "boolean") {
    return <span className="dcrChat__jsonBoolean">{value ? "true" : "false"}</span>;
  }
  if (typeof value === "number") return <span className="dcrChat__jsonNumber">{String(value)}</span>;
  if (typeof value === "string") return <JsonString value={value} />;

  if (Array.isArray(value)) {
    if (!value.length) return <span className="dcrChat__jsonEmpty">[]</span>;
    if (value.every(isPrimitive)) {
      return (
        <ul className="dcrChat__jsonList dcrChat__jsonList--inline">
          {value.map((item, index) => (
            <li key={index}><JsonNode value={item} depth={depth + 1} /></li>
          ))}
        </ul>
      );
    }
    return (
      <ol className="dcrChat__jsonList">
        {value.map((item, index) => (
          <li key={index}>
            <JsonBranch value={item} depth={depth + 1} />
          </li>
        ))}
      </ol>
    );
  }

  const entries = Object.entries(value);
  if (!entries.length) return <span className="dcrChat__jsonEmpty">{"{}"}</span>;
  return (
    <dl className="dcrChat__jsonObject">
      {entries.map(([key, item]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd><JsonBranch value={item} depth={depth + 1} /></dd>
        </div>
      ))}
    </dl>
  );
}

/** Wraps non-empty nested containers in a collapsible block with a size summary. */
function JsonBranch({ value, depth }: { value: JsonValue; depth: number }) {
  if (isPrimitive(value)) return <JsonNode value={value} depth={depth} />;
  const size = Array.isArray(value) ? value.length : Object.keys(value).length;
  if (!size || (Array.isArray(value) && value.every(isPrimitive))) {
    return <JsonNode value={value} depth={depth} />;
  }
  const label = Array.isArray(value)
    ? `${size} ${size === 1 ? "item" : "items"}`
    : `${size} ${size === 1 ? "field" : "fields"}`;
  return (
    <details open={depth <= OPEN_DEPTH}>
      <summary>{label}</summary>
      <JsonNode value={value} depth={depth} />
    </details>
  );
}

function JsonString({ value }: { value: string }) {
  if (/^https?:\/\/\S+$/i.test(value)) {
    return (
      <a className="dcrChat__jsonString" href={value} target="_blank" rel="noreferrer">{value}</a>
    );
  }
  return <span className="dcrChat__jsonString">{value}</span>;
}

function isPrimitive(value: JsonValue): value is null | boolean | number | string {
  return value === null || typeof value !== "object";
}
