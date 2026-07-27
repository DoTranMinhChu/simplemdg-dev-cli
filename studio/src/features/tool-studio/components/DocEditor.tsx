import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Spinner } from "../../../components/common/Spinner";
import { Button } from "../../../components/common/Button";
import { docxBytesToHtml, tiptapJsonToDocxBlob } from "../../../lib/docx-tiptap-bridge";

export type TDocEditorHandle = {
  exportBytes: () => Promise<Blob>;
};

type TDocEditorProps = {
  bytes: ArrayBuffer;
  onDirtyChange?: (dirty: boolean) => void;
};

export const DocEditor = forwardRef<TDocEditorHandle, TDocEditorProps>(function DocEditor({ bytes, onDirtyChange }, ref) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  const editor = useEditor({
    extensions: [StarterKit],
    content: "",
    onUpdate: () => onDirtyChange?.(true),
  });

  useEffect(() => {
    if (!editor) return;
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    docxBytesToHtml(bytes)
      .then((html) => {
        if (cancelled) return;
        editor.commands.setContent(html, { emitUpdate: false });
        setLoading(false);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bytes, editor]);

  useImperativeHandle(
    ref,
    () => ({
      exportBytes: async () => {
        if (!editor) throw new Error("Editor is not ready yet");
        return tiptapJsonToDocxBlob(editor.getJSON());
      },
    }),
    [editor],
  );

  if (error) {
    return <div className="errbox">Could not open this document: {error}</div>;
  }

  if (loading || !editor) {
    return (
      <div className="note faint" style={{ padding: 16 }}>
        <Spinner /> Parsing document...
      </div>
    );
  }

  return (
    <div className="ts-doc-editor">
      <div className="ts-doc-toolbar">
        <Button size="sm" variant={editor.isActive("bold") ? "primary" : "ghost"} onClick={() => editor.chain().focus().toggleBold().run()}>
          Bold
        </Button>
        <Button size="sm" variant={editor.isActive("italic") ? "primary" : "ghost"} onClick={() => editor.chain().focus().toggleItalic().run()}>
          Italic
        </Button>
        <Button size="sm" variant={editor.isActive("strike") ? "primary" : "ghost"} onClick={() => editor.chain().focus().toggleStrike().run()}>
          Strike
        </Button>
        <Button size="sm" variant={editor.isActive("heading", { level: 1 }) ? "primary" : "ghost"} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>
          H1
        </Button>
        <Button size="sm" variant={editor.isActive("heading", { level: 2 }) ? "primary" : "ghost"} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
          H2
        </Button>
        <Button size="sm" variant={editor.isActive("heading", { level: 3 }) ? "primary" : "ghost"} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
          H3
        </Button>
        <Button size="sm" variant={editor.isActive("bulletList") ? "primary" : "ghost"} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          • List
        </Button>
        <Button size="sm" variant={editor.isActive("orderedList") ? "primary" : "ghost"} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          1. List
        </Button>
        <Button size="sm" variant="ghost" onClick={() => editor.chain().focus().undo().run()}>
          Undo
        </Button>
        <Button size="sm" variant="ghost" onClick={() => editor.chain().focus().redo().run()}>
          Redo
        </Button>
      </div>
      <EditorContent editor={editor} className="ts-doc-content" />
    </div>
  );
});
