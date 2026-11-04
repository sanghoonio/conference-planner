import { Fragment } from 'react';

/** Plain text → paragraphs (blank line) with line breaks (single newline); bare URLs become links. */
export function Paragraphs({ text }: { text: string }) {
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return (
    <>
      {paras.map((p, i) => (
        <p key={i}>
          {p.split('\n').map((line, j) => (
            <Fragment key={j}>
              {j > 0 && <br />}
              {linkify(line)}
            </Fragment>
          ))}
        </p>
      ))}
    </>
  );
}

function linkify(s: string) {
  const parts = s.split(/(https?:\/\/[^\s)<>]+[^\s)<>.,;:])/g);
  return parts.map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a key={i} href={part} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
        {part}
      </a>
    ) : (
      part
    ),
  );
}

/** Expandable Abstract + Authors (+ Affiliations) block shared by posters and presentations. */
export function BodyBlock({ abstract, authors, affiliations }: { abstract: string | null; authors: string | null; affiliations: string | null }) {
  return (
    <>
      {abstract && (
        <>
          <div className="abs-cap">Abstract</div>
          <Paragraphs text={abstract} />
        </>
      )}
      {authors && (
        <>
          <div className="abs-cap" style={abstract ? { marginTop: 12 } : undefined}>
            Authors
          </div>
          <div className="au-text">{authors}</div>
        </>
      )}
      {affiliations && (
        <>
          <div className="abs-cap" style={{ marginTop: 12 }}>
            Affiliations
          </div>
          <div className="au-text">{affiliations}</div>
        </>
      )}
    </>
  );
}

export const Sep = () => <span className="sep">·</span>;

/** Join nodes with the reference's middle-dot separator. */
export function joinSep(nodes: React.ReactNode[]) {
  return nodes.filter(Boolean).map((n, i) => (
    <Fragment key={i}>
      {i > 0 && <Sep />}
      {n}
    </Fragment>
  ));
}
