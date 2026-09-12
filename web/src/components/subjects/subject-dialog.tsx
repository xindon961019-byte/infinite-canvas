import { useRef, useState } from "react";
import { App, Button, Image, Input, Modal } from "antd";
import { AudioLines, ImagePlus, X } from "lucide-react";
import { readSubjectMedia, useSubjectStore, type Subject } from "@/stores/use-subject-store";

export function SubjectDialog({ subject, onClose, onSaved }: { subject?: Subject; onClose: () => void; onSaved?: (subject: Subject) => void }) {
    const { message } = App.useApp();
    const save = useSubjectStore((state) => state.save);
    const [draft, setDraft] = useState<Subject>(() => subject || { id: crypto.randomUUID(), name: "", description: "", images: [] });
    const [busy, setBusy] = useState(false);
    const images = useRef<HTMLInputElement>(null);
    const voice = useRef<HTMLInputElement>(null);
    const add = async (files: FileList | null, audio = false) => {
        if (!files?.length) return;
        setBusy(true);
        try {
            const media = await readSubjectMedia(Array.from(files).filter((file) => file.type.startsWith(audio ? "audio/" : "image/")));
            if (!media.length) throw new Error(audio ? "请选择音频文件" : "请选择图片文件");
            setDraft((current) => audio ? { ...current, voice: media[0] } : { ...current, images: [...current.images, ...media] });
        } catch (error) { void message.error(error instanceof Error ? error.message : "添加失败"); }
        finally { setBusy(false); }
    };
    return <Modal open title={<span className="flex items-center gap-2 text-[22px] font-semibold">设置主体 <span className="text-sm text-white/40">ⓘ</span></span>} width={760} centered className="subject-dialog" onCancel={onClose} footer={<Button type="primary" loading={busy} disabled={!draft.name.trim() || !draft.images.length} onClick={async () => {
        setBusy(true);
        try { const next = { ...draft, name: draft.name.trim() }; await save(next); void message.success("主体已保存到我的资产"); onSaved?.(next); onClose(); }
        catch { void message.error("主体保存失败，请重试"); }
        finally { setBusy(false); }
    }}>保存</Button>}>
        <div className="space-y-7 py-5">
            <div><div className="mb-3 text-[16px] font-medium">参考主体 <span className="text-destructive">*</span></div>
                <div className="flex min-h-[230px] gap-3 overflow-x-auto rounded-xl bg-[#292929] p-3">
                    <Image.PreviewGroup>{draft.images.map((item) => <div key={item.id} className="relative h-[204px] min-w-[180px] overflow-hidden rounded-lg bg-[#202020]"><Image src={item.url} alt={item.name} width="100%" height="100%" style={{ objectFit: "contain" }} /><Button aria-label={`移除 ${item.name}`} type="text" size="small" className="!absolute right-1 top-1 !text-white/70" icon={<X size={15} />} onClick={() => setDraft((current) => ({ ...current, images: current.images.filter((image) => image.id !== item.id) }))} /></div>)}</Image.PreviewGroup>
                    <button type="button" aria-label="添加主体参考图片" disabled={busy} className="flex h-[204px] min-w-[150px] items-center justify-center rounded-lg bg-[#343434] text-white/80 transition hover:bg-[#414141]" onClick={() => images.current?.click()}><ImagePlus size={28} />
                    </button>
                </div>
                <input hidden ref={images} type="file" accept="image/*" multiple onChange={(event) => { void add(event.target.files); event.target.value = ""; }} />
            </div>
            <div>{draft.voice ? <div className="rounded-xl border border-white/10 bg-[#292929] p-3"><div className="mb-2 flex items-center justify-between gap-3"><span className="truncate text-sm">{draft.voice.name}</span><Button type="text" aria-label="移除音色" icon={<X size={16} />} onClick={() => setDraft((current) => ({ ...current, voice: undefined }))} /></div><audio controls src={draft.voice.url} className="w-full" /></div> : <button type="button" disabled={busy} className="flex h-[118px] w-[118px] flex-col items-center justify-center gap-3 rounded-xl bg-[#292929] text-white/80 transition hover:bg-[#353535]" onClick={() => voice.current?.click()}><AudioLines size={28} /><span className="text-sm">添加音色</span></button>}
                <input hidden ref={voice} type="file" accept="audio/*" onChange={(event) => { void add(event.target.files, true); event.target.value = ""; }} />
            </div>
            <label className="block space-y-3"><span className="text-[16px] font-medium">名称 <span className="text-destructive">*</span></span><Input maxLength={20} size="large" placeholder="请输入名称" value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></label>
            <label className="block space-y-3"><span className="text-[16px] font-medium">描述</span><Input.TextArea rows={4} placeholder="请输入描述" value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} /></label>
        </div>
    </Modal>;
}
