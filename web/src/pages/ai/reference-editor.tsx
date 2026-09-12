import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Button, Dropdown, Empty, Image, Modal } from "antd";
import { MoreHorizontal, Plus } from "lucide-react";
import type { Part } from "./use-workspace";

export type Candidate = { id: string; kind: "asset" | "subject"; name: string; url: string };
export type EditorHandle = { openReferences: () => void; insert: (item: Candidate) => void };
export const ReferenceEditor = forwardRef<EditorHandle, { initial: Part[]; candidates: Candidate[]; onChange: (parts: Part[]) => void; onCreate: () => void; onEdit: (id: string) => void; onDelete: (id: string) => void }>(function ReferenceEditor({ initial, candidates, onChange, onCreate, onEdit, onDelete }, ref) {
    const editor = useRef<HTMLDivElement>(null);
    const range = useRef<Range | null>(null);
    const [preview, setPreview] = useState<Candidate | null>(null);
    const [menu, setMenu] = useState(false);
    const [query, setQuery] = useState("");
    const [active, setActive] = useState(0);
    const [empty, setEmpty] = useState(!initial.length);
    const root = useRef<HTMLDivElement>(null);
    const filtered = candidates.filter((item) => item.name.toLowerCase().includes(query.toLowerCase()));
    const makeToken = (part: Part) => {
        const item = candidates.find((candidate) => candidate.id === part.id && candidate.kind === part.kind);
        const token = document.createElement("span");
        token.contentEditable = "false";
        token.dataset.reference = part.id;
        token.dataset.kind = part.kind;
        token.dataset.label = item?.name || part.text;
        token.className = "mx-1 inline-flex items-center gap-1.5 rounded-lg bg-muted px-2 py-0.5 align-middle text-sm";
        token.title = item?.name || `引用已失效：${part.text}`;
        if (item?.url) { const img = document.createElement("img"); img.src = item.url; img.alt = ""; img.className = "size-5 rounded object-cover"; token.append(img); }
        token.append(document.createTextNode(`@${item?.name || part.text}${item ? "" : "（已失效）"}`));
        if (!item) token.classList.add("text-destructive");
        return token;
    };
    const emit = () => {
        const parts: Part[] = [];
        const visit = (node: Node) => {
            if (node instanceof HTMLElement && node.dataset.reference) { parts.push({ id: node.dataset.reference, kind: node.dataset.kind as Part["kind"], text: node.dataset.label || "" }); return; }
            if (node.nodeType === Node.TEXT_NODE) { if (node.textContent) parts.push({ text: node.textContent }); return; }
            if (node.nodeName === "BR") parts.push({ text: "\n" });
            else { if (node !== editor.current && (node.nodeName === "DIV" || node.nodeName === "P") && parts.length) parts.push({ text: "\n" }); node.childNodes.forEach(visit); }
        };
        if (editor.current) visit(editor.current);
        setEmpty(!parts.some((part) => part.id || part.text.trim()));
        onChange(parts);
    };
    useEffect(() => {
        const el = editor.current;
        if (el) el.replaceChildren();
        if (el) for (const part of initial) el.append(part.id ? makeToken(part) : document.createTextNode(part.text));
        // Restore the draft once. Subsequent edits stay in the native editor to preserve selection.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    useEffect(() => {
        editor.current?.querySelectorAll<HTMLElement>("[data-reference]").forEach((token) => {
            const item = candidates.find((candidate) => candidate.id === token.dataset.reference && candidate.kind === token.dataset.kind);
            if ((item?.name || "") !== token.dataset.label || (Boolean(item) === token.classList.contains("text-destructive"))) token.replaceWith(makeToken({ id: token.dataset.reference, kind: token.dataset.kind as Part["kind"], text: token.dataset.label || "" }));
        });
    }, [candidates]);
    useEffect(() => {
        const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setMenu(false); };
        document.addEventListener("pointerdown", close);
        return () => document.removeEventListener("pointerdown", close);
    }, []);
    const remember = () => {
        if (menu) return;
        const selection = window.getSelection();
        if (selection?.rangeCount && editor.current?.contains(selection.anchorNode)) range.current = selection.getRangeAt(0).cloneRange();
    };
    const insert = (item: Candidate) => {
        const el = editor.current;
        if (!el) return;
        el.focus();
        const target = range.current && el.contains(range.current.startContainer) ? range.current : document.createRange();
        if (!el.contains(target.startContainer)) { target.selectNodeContents(el); target.collapse(false); }
        target.deleteContents();
        const token = makeToken({ id: item.id, kind: item.kind, text: item.name });
        target.insertNode(token);
        const space = document.createTextNode(" "); token.after(space);
        target.setStartAfter(space); target.collapse(true);
        const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(target);
        range.current = target.cloneRange(); setMenu(false); setQuery(""); emit();
    };
    const openReferences = () => { remember(); setQuery(""); setActive(0); setMenu(true); };
    useImperativeHandle(ref, () => ({ openReferences, insert }));
    return <div ref={root} className="relative min-w-0 flex-1">
        {empty && <div className="pointer-events-none absolute left-0 top-1 text-base leading-8 text-muted-foreground sm:text-lg">输入想法、剧本或上传参考，输入 @ 引用主体或素材，和 Agent 一起创作</div>}
        <div ref={editor} role="textbox" aria-label="创作需求" aria-multiline contentEditable suppressContentEditableWarning className="min-h-36 whitespace-pre-wrap break-words text-base leading-8 outline-none sm:min-h-40 sm:text-lg" onClick={(event) => {
            const target = (event.target as HTMLElement).closest<HTMLElement>("[data-reference]");
            if (target) setPreview(candidates.find((item) => item.id === target.dataset.reference && item.kind === target.dataset.kind) || null);
        }} onMouseUp={remember} onKeyUp={remember} onInput={(event) => {
            emit(); remember();
            if ((event.nativeEvent as InputEvent).isComposing) return;
            const selection = window.getSelection(); const node = selection?.anchorNode;
            if (node?.nodeType === Node.TEXT_NODE) {
                const offset = selection?.anchorOffset || 0;
                const match = /@([^@\s]*)$/.exec((node.textContent || "").slice(0, offset));
                if (match) { const target = document.createRange(); target.setStart(node, offset - match[0].length); target.setEnd(node, offset); range.current = target; setQuery(match[1]); setMenu(true); setActive(0); return; }
            }
            setMenu(false);
        }} onPaste={(event) => { event.preventDefault(); document.execCommand("insertText", false, event.clipboardData.getData("text/plain")); }} onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (menu && event.key === "Escape") { event.preventDefault(); setMenu(false); }
            if (menu && filtered.length && ["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) { event.preventDefault(); if (event.key === "Enter") insert(filtered[Math.min(active, filtered.length - 1)]); else setActive((value) => (value + (event.key === "ArrowDown" ? 1 : -1) + filtered.length) % filtered.length); }
        }} />
        {menu && <div className="absolute left-0 top-12 z-30 w-[min(340px,75vw)] rounded-2xl border border-border bg-popover p-2 text-popover-foreground shadow-lg" onMouseDown={(event) => event.preventDefault()}>
            <div className="px-3 py-2 text-xs text-muted-foreground">可引用的内容</div>
            <Button type="text" block className="!justify-start" icon={<Plus size={17} />} onClick={() => { setMenu(false); onCreate(); }}>创建主体</Button>
            <div className="max-h-64 overflow-y-auto">{filtered.map((item, index) => <div key={`${item.kind}:${item.id}`} className={`flex items-center gap-1 rounded-xl ${index === active ? "bg-muted" : ""}`}>
                <button type="button" title={item.name} className="flex min-w-0 flex-1 items-center gap-3 p-3 text-left" onClick={() => insert(item)}><img src={item.url} alt="" className="size-10 rounded-lg object-cover" /><span className="min-w-0 flex-1 truncate">{item.name}</span><span className="text-xs text-muted-foreground">{item.kind === "subject" ? "主体" : "图片"}</span></button>
                {item.kind === "subject" && <Dropdown menu={{ items: [{ key: "edit", label: "编辑主体" }, { key: "delete", label: "删除主体", danger: true }], onClick: ({ key }) => { setMenu(false); if (key === "edit") onEdit(item.id); else onDelete(item.id); } }} trigger={["click"]}><Button type="text" aria-label={`管理 ${item.name}`} icon={<MoreHorizontal size={17} />} /></Dropdown>}
            </div>)}{!filtered.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={candidates.length ? "没有匹配的内容" : "上传参考图片或创建主体"} />}</div>
        </div>}
        <Modal open={Boolean(preview)} title={preview?.name} footer={null} onCancel={() => setPreview(null)}>{preview && <Image src={preview.url} alt={preview.name} style={{ maxHeight: 420, objectFit: "contain" }} />}</Modal>
    </div>;
});
