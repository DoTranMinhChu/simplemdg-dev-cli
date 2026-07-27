/**
 * Converts between real .docx bytes and TipTap's ProseMirror JSON document.
 *
 * Loading goes through mammoth (.docx -> HTML), which TipTap then parses natively via
 * `setContent(html)`. Saving walks TipTap's JSON doc directly and rebuilds a fresh .docx with the
 * `docx` package — this is a basic-formatting round trip (paragraphs, headings, bold/italic/strike,
 * bullet/numbered lists), not a byte-for-byte preservation of the original file's structure.
 */
import * as mammoth from "mammoth";
import { AlignmentType, Document, HeadingLevel, LevelFormat, Packer, Paragraph, TextRun } from "docx";
import type { JSONContent } from "@tiptap/react";

const HEADING_BY_LEVEL: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
  5: HeadingLevel.HEADING_5,
  6: HeadingLevel.HEADING_6,
};

const BULLET_LIST_REF = "file-editor-bullet-list";
const ORDERED_LIST_REF = "file-editor-ordered-list";

export async function docxBytesToHtml(bytes: ArrayBuffer): Promise<string> {
  const result = await mammoth.convertToHtml({ arrayBuffer: bytes });
  return result.value;
}

type TListContext = { reference: string; level: number };

function inlineToRuns(node: JSONContent): TextRun[] {
  if (node.type === "hardBreak") return [new TextRun({ text: "", break: 1 })];
  if (node.type !== "text") return [];
  const marks = node.marks ?? [];
  return [
    new TextRun({
      text: node.text ?? "",
      bold: marks.some((mark) => mark.type === "bold"),
      italics: marks.some((mark) => mark.type === "italic"),
      strike: marks.some((mark) => mark.type === "strike"),
    }),
  ];
}

function walkListItem(listItem: JSONContent, context: TListContext, paragraphs: Paragraph[]): void {
  for (const child of listItem.content ?? []) walkBlock(child, paragraphs, context);
}

function walkBlock(node: JSONContent, paragraphs: Paragraph[], listContext?: TListContext): void {
  switch (node.type) {
    case "paragraph":
      paragraphs.push(
        new Paragraph({
          children: (node.content ?? []).flatMap(inlineToRuns),
          ...(listContext ? { numbering: { reference: listContext.reference, level: listContext.level } } : {}),
        }),
      );
      return;
    case "heading":
      paragraphs.push(
        new Paragraph({
          heading: HEADING_BY_LEVEL[(node.attrs?.level as number | undefined) ?? 1] ?? HeadingLevel.HEADING_1,
          children: (node.content ?? []).flatMap(inlineToRuns),
        }),
      );
      return;
    case "bulletList":
      for (const item of node.content ?? []) walkListItem(item, { reference: BULLET_LIST_REF, level: 0 }, paragraphs);
      return;
    case "orderedList":
      for (const item of node.content ?? []) walkListItem(item, { reference: ORDERED_LIST_REF, level: 0 }, paragraphs);
      return;
    default:
      for (const child of node.content ?? []) walkBlock(child, paragraphs, listContext);
  }
}

export async function tiptapJsonToDocxBlob(doc: JSONContent): Promise<Blob> {
  const paragraphs: Paragraph[] = [];
  for (const node of doc.content ?? []) walkBlock(node, paragraphs);

  const document = new Document({
    numbering: {
      config: [
        {
          reference: BULLET_LIST_REF,
          levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }],
        },
        {
          reference: ORDERED_LIST_REF,
          levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }],
        },
      ],
    },
    sections: [{ children: paragraphs }],
  });

  return Packer.toBlob(document);
}
