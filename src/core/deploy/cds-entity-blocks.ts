/**
 * Shared brace-depth block scanner for already-written CDS text (not CSN) — used by
 * `custom-model-preserver.ts` (Part A: recover a customer-authored `custom-model.cds` attachment
 * before a full regenerate wipes it) and `cds-model-reader.ts` (Part B: browse the currently
 * committed model for the Custom Model editor). Deliberately a small regex/depth-counter, not a
 * real CDS parser — this codebase's own generator (`csn-model-builder.ts`) already works the same
 * way (flat line arrays, not an AST), so this matches the existing style rather than introducing a
 * second parsing philosophy.
 */

export type TCdsEntityBlock = {
  name: string;
  /** The `entity Name : Base1, Base2 {` header line itself, verbatim. */
  header: string;
  /** Everything between the header's `{` and its matching `}`, exclusive of both braces. */
  body: string;
  /** Index into the ORIGINAL content string right after the header's opening `{` (i.e. where `body` starts) — lets a caller locate `body` substrings back in the original text. */
  bodyStart: number;
  /** Index into the original content string of the block's closing `}` itself — insert new content right before this index to append inside the entity. */
  bodyEnd: number;
};

/**
 * Finds every top-level `entity <Name> : ... { ... }` block in `content`. Annotations like
 * `@(title: '...')` never contain braces, so a simple depth counter from the header's own `{` to
 * its matching `}` is safe — no need to track annotation/string context separately.
 */
export function findEntityBlocks(content: string): TCdsEntityBlock[] {
  const blocks: TCdsEntityBlock[] = [];
  const headerRegex = /entity\s+(\w+)\s*:[^{]*\{/g;
  let match: RegExpExecArray | null;

  while ((match = headerRegex.exec(content))) {
    const name = match[1];
    const openBraceIndex = match.index + match[0].length - 1;

    let depth = 1;
    let i = openBraceIndex + 1;
    for (; i < content.length && depth > 0; i++) {
      if (content[i] === "{") depth++;
      else if (content[i] === "}") depth--;
    }
    const closeBraceIndex = i - 1;
    if (depth > 0) break; // unterminated block — malformed input, stop rather than scan garbage

    blocks.push({ name, header: match[0], body: content.slice(openBraceIndex + 1, closeBraceIndex), bodyStart: openBraceIndex + 1, bodyEnd: closeBraceIndex });
    headerRegex.lastIndex = closeBraceIndex + 1;
  }

  return blocks;
}

const RELATION_HEADER = /(\w+)\s*:\s*(Composition of one|Composition of many|Association to one|Association to many)\s+(\w+)([\s\S]*?);/g;

export type TCdsRelation = { field: string; cardinality: "one" | "many"; target: string; fullText: string };

/** Finds every composition/association field declaration within one entity block's `body`. */
export function findRelationsInBody(body: string): TCdsRelation[] {
  const relations: TCdsRelation[] = [];
  const regex = new RegExp(RELATION_HEADER);
  let match: RegExpExecArray | null;
  while ((match = regex.exec(body))) {
    const cardinality = /many/i.test(match[2]) ? "many" : "one";
    relations.push({ field: match[1], cardinality, target: match[3], fullText: match[0] });
  }
  return relations;
}
