import { useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Empty, Image, Modal, Popover, Segmented, Select, Spin, Switch, Tag } from "antd";
import { ArrowUp, AtSign, Bot, Check, Download, ImagePlus, LoaderCircle, Plus, SlidersHorizontal, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { SubjectDialog } from "@/components/subjects/subject-dialog";
import { readSubjectMedia, useSubjectStore, type Subject } from "@/stores/use-subject-store";
import { modelOptionLabel, selectableModelsByCapability, useEffectiveConfig } from "@/stores/use-config-store";
import { ReferenceEditor, type EditorHandle } from "./reference-editor";
import { buildCreationRequest, creationPrompt, type CreationRequest } from "@/lib/ai/creation-request";
import { createVideoGenerationTask, pollVideoGenerationTask, storeGeneratedVideo } from "@/services/api/video";
import { useAssetStore } from "@/stores/use-asset-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import { useWorkspace } from "./use-workspace";

const ratios = { image: ["智能", "1:1", "3:4", "16:9", "4:3", "9:16", "2:3", "3:2", "21:9"], video: ["智能", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] };
export default function AiPage() {
    const { message, modal } = App.useApp();
    const navigate = useNavigate();
    const { data, setData, ready } = useWorkspace();
    const config = useEffectiveConfig();
    const subjects = useSubjectStore((state) => state.subjects);
    const subjectsReady = useSubjectStore((state) => state.ready);
    const loadSubjects = useSubjectStore((state) => state.load);
    const removeSubject = useSubjectStore((state) => state.remove);
    const input = useRef<HTMLInputElement>(null);
    const editor = useRef<EditorHandle>(null);
    const [subjectDialog, setSubjectDialog] = useState<Subject | "new" | null>(null);
    const [mediaOpen, setMediaOpen] = useState(false);
    const [preferencesOpen, setPreferencesOpen] = useState(false);
    const addAsset = useAssetStore((state) => state.addAsset);
    const [preview, setPreview] = useState<CreationRequest | null>(null);
    const [result, setResult] = useState<{ url: string; storageKey: string } | null>(null);
    const [reading, setReading] = useState(false);
    useEffect(() => { void loadSubjects().catch(() => message.error("主体读取失败，请刷新后重试")); }, [loadSubjects, message]);
    const candidates = useMemo(() => [
        ...data.assets.map((item) => ({ id: item.id, name: item.name, url: item.url, kind: "asset" as const })),
        ...subjects.map((item) => ({ id: item.id, name: item.name, url: item.images[0]?.url || "", kind: "subject" as const })),
    ], [data.assets, subjects]);
    const preference = data[data.kind];
    const models = selectableModelsByCapability(config, data.kind);
    const selectedModel = preference.model || (data.kind === "image" ? config.imageModel : config.videoModel);
    const invalid = data.parts.some((part) => part.id && !candidates.some((item) => item.id === part.id && item.kind === part.kind));
    const canSubmit = data.assets.length > 0 || data.parts.some((part) => part.id || part.text.trim());
    const setPreference = (patch: Partial<typeof preference>) => setData((current) => ({ ...current, [current.kind]: { ...current[current.kind], ...patch } }));
    const addImages = async (files: FileList | File[] | null) => {
        if (!files?.length) return;
        setReading(true);
        try { const images = await readSubjectMedia(Array.from(files).filter((file) => file.type.startsWith("image/"))); if (!images.length) throw new Error("请选择图片文件"); setData((current) => ({ ...current, assets: [...current.assets, ...images] })); }
        catch (error) { void message.error(error instanceof Error ? error.message : "图片添加失败"); }
        finally { setReading(false); }
    };
    const deleteSubject = (id: string) => modal.confirm({ title: "删除主体？", content: "删除后，当前草稿中对这个主体的引用将失效。", okText: "删除", cancelText: "取消", okButtonProps: { danger: true }, onOk: async () => { try { await removeSubject(id); } catch { void message.error("删除失败，请重试"); throw new Error("删除失败"); } } });
    const generateVideo = async () => {
        if (invalid) { void message.warning("请移除或替换已失效的引用"); return; }
        if (data.kind !== "video") { void message.warning("当前工作台暂只接入视频生成"); return; }
        setReading(true);
        setResult(null);
        try {
            const creation = buildCreationRequest(data, subjects, selectedModel);
            const media = creation.media;
            const images: ReferenceImage[] = media.filter((item) => item.kind === "image").map((item) => ({ id: item.id, name: item.name, type: "image/*", dataUrl: item.url }));
            const videos: ReferenceVideo[] = media.filter((item) => item.kind === "video").map((item) => ({ id: item.id, name: item.name, type: "video/*", url: item.url }));
            const audios: ReferenceAudio[] = media.filter((item) => item.kind === "audio").map((item) => ({ id: item.id, name: item.name, type: "audio/*", url: item.url }));
            const custom = creation.preferences;
            const requestConfig = { ...config, model: selectedModel, videoModel: selectedModel, size: custom.ratio === "智能" ? "auto" : custom.ratio || config.size, vquality: custom.quality === "auto" ? config.vquality : custom.quality || config.vquality, videoMode: "reference" };
            setPreview(creation);
            const task = await createVideoGenerationTask(requestConfig, creationPrompt(creation), images, { videos, audios, creation });
            for (;;) {
                const state = await pollVideoGenerationTask(requestConfig, task);
                if (state.status === "failed") throw new Error(state.error);
                if (state.status === "pending") { await new Promise((resolve) => window.setTimeout(resolve, 2500)); continue; }
                const stored = await storeGeneratedVideo(state.result);
                addAsset({ kind: "video", title: creationPrompt(creation).slice(0, 30) || "AI 工作台视频", coverUrl: "", tags: [], source: "AI 工作台", data: { url: stored.url, storageKey: stored.storageKey, width: stored.width || 1280, height: stored.height || 720, bytes: stored.bytes, mimeType: stored.mimeType }, metadata: { source: "ai-workbench", creation } });
                setResult({ url: stored.url, storageKey: stored.storageKey });
                void message.success("视频生成完成，已保存到我的素材");
                break;
            }
        } catch (error) { void message.error(error instanceof Error ? error.message : "视频生成失败"); }
        finally { setReading(false); }
    };
    if (!ready || !subjectsReady) return <div className="grid h-full place-items-center"><Spin tip="正在读取工作台" /></div>;
    const settings = <div className="w-[min(560px,calc(100vw-56px))] p-2 sm:p-4">
        <div className="mb-5 flex items-center justify-between"><span className="text-base font-medium">生成偏好</span><label className="flex items-center gap-2 text-sm text-muted-foreground">自动 <Switch size="small" checked={data.auto} onChange={(auto) => setData((current) => ({ ...current, auto }))} /></label></div>
        <Segmented block size="large" value={data.kind} options={[{ label: "图片", value: "image" }, { label: "视频", value: "video" }]} onChange={(kind) => setData((current) => ({ ...current, kind: kind as "image" | "video" }))} />
        <div className={`mt-6 space-y-5 ${data.auto ? "opacity-50" : ""}`}>
            <div><div className="mb-3 text-xs text-muted-foreground">选择比例</div><div className="flex flex-wrap gap-1">{ratios[data.kind].map((ratio) => {
                const [w, h] = ratio === "智能" ? [1, 1] : ratio.split(":").map(Number);
                return <button type="button" key={ratio} disabled={data.auto} aria-pressed={preference.ratio === ratio} onClick={() => setPreference({ ratio })} className={`flex min-w-12 flex-1 flex-col items-center gap-3 rounded-xl px-2 py-3 text-xs transition hover:bg-black/5 dark:hover:bg-white/10 ${preference.ratio === ratio ? "bg-muted font-medium" : ""}`}><span className="flex h-5 items-center justify-center">{ratio === "智能" ? <ImagePlus size={17} /> : <span className="block rounded-[3px] border-[1.5px] border-current" style={{ width: 20 * Math.min(1, w / h), height: 20 * Math.min(1, h / w) }} />}</span>{ratio}</button>;
            })}</div></div>
            <div><div className="mb-3 text-xs text-muted-foreground">其他设置</div><div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><Select aria-label="生成模型" size="large" disabled={data.auto} placeholder="请选择模型" value={models.includes(selectedModel) ? selectedModel : undefined} options={models.map((value) => ({ value, label: modelOptionLabel(config, value) }))} onChange={(model) => setPreference({ model })} notFoundContent="暂无可用模型" /><Select aria-label="清晰度" size="large" disabled={data.auto} value={preference.quality} options={(data.kind === "image" ? ["auto", "1k", "2k", "4k"] : ["auto", "480p", "720p", "1080p"]).map((value) => ({ value, label: value === "auto" ? "智能清晰度" : value.toUpperCase() }))} onChange={(quality) => setPreference({ quality })} /></div></div>
        </div>
        {data.auto && <p className="mb-0 mt-4 text-xs text-muted-foreground">由 Agent 决定生成偏好，关闭自动后可自定义。</p>}
    </div>;
    return <main className="h-full overflow-y-auto bg-background text-foreground">
        <div className="mx-auto flex min-h-full max-w-[1440px] flex-col px-5 pb-20 pt-[clamp(56px,10vh,120px)] sm:px-12">
            <header className="text-center"><h1 className="text-balance text-3xl font-medium tracking-tight sm:text-[42px] sm:leading-tight">你好，今天想要创作什么？</h1>
                <div className="mx-auto mt-9 flex w-full max-w-[390px] rounded-full bg-muted/60 p-1"><button type="button" aria-current="page" className="flex-1 rounded-full bg-background py-3 text-sm font-medium shadow-sm">生成</button><button type="button" className="flex-1 rounded-full py-3 text-sm text-muted-foreground transition hover:text-foreground" onClick={() => navigate("/canvas")}>画布</button></div>
            </header>
            <section aria-label="AI 工作台" className="relative mt-12 rounded-[28px] border border-border/60 bg-card p-5 transition focus-within:border-border sm:mt-14 sm:p-7" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void addImages(event.dataTransfer.files); }}>
                <div className="flex gap-5 sm:gap-7">
                    <div className="relative mt-2 h-24 w-16 shrink-0 sm:w-20">
                        {data.assets.length ? <button type="button" aria-label={`查看 ${data.assets.length} 张参考图片`} className="relative block h-20 w-full" onClick={() => setMediaOpen(true)}>{data.assets.slice(-3).map((item, index, list) => <img key={item.id} src={item.url} alt={item.name} className="absolute inset-0 h-20 w-full rounded-lg border border-border bg-background object-cover shadow-sm" style={{ transform: `rotate(${(index - list.length + 1) * 7 - 3}deg) translate(${(index - list.length + 1) * -3}px, ${(index - list.length + 1) * -3}px)` }} />)}</button> : <button type="button" aria-label="添加参考图片" className="flex h-20 w-full -rotate-6 items-center justify-center rounded-xl border border-dashed border-border text-muted-foreground transition hover:rotate-0 hover:text-foreground" onClick={() => input.current?.click()}><Plus size={26} strokeWidth={1.5} /></button>}
                        {data.assets.length > 0 && <button type="button" aria-label="继续添加图片" disabled={reading} className="absolute -right-2 bottom-1 flex size-8 items-center justify-center rounded-full border border-border bg-background" onClick={() => input.current?.click()}><Plus size={17} /></button>}
                    </div>
                    <ReferenceEditor ref={editor} initial={data.parts} candidates={candidates} onChange={(parts) => setData((current) => ({ ...current, parts }))} onCreate={() => setSubjectDialog("new")} onEdit={(id) => setSubjectDialog(subjects.find((item) => item.id === id) || null)} onDelete={deleteSubject} />
                </div>
                <input ref={input} type="file" accept="image/*" multiple hidden onChange={(event) => { void addImages(event.target.files); event.target.value = ""; }} />
                <div className="mt-5 flex items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1 sm:gap-3"><span className="inline-flex items-center gap-2 px-2 py-2 text-sm font-medium"><Bot size={18} />Agent 模式</span><Popover trigger="click" placement="bottomLeft" open={preferencesOpen} onOpenChange={setPreferencesOpen} content={settings}><Button type="text" icon={<SlidersHorizontal size={17} />}>{data.auto ? "自动" : "自定义"}</Button></Popover><Button type="text" aria-label="引用主体或素材" icon={<AtSign size={19} />} onMouseDown={(event) => event.preventDefault()} onClick={() => editor.current?.openReferences()} /></div>
                    <Button type="primary" shape="circle" size="large" aria-label="发送生成视频" icon={<ArrowUp size={23} />} loading={reading} disabled={!canSubmit} onClick={() => void generateVideo()} />
                </div>
            </section>
            {invalid && <p className="px-3 text-sm text-destructive">有主体或素材已被移除，请删除对应引用后重新选择。</p>}
            {reading && <p className="px-3 text-sm text-muted-foreground">正在添加参考图片…</p>}
        </div>
        {subjectDialog && <SubjectDialog subject={subjectDialog === "new" ? undefined : subjectDialog} onClose={() => setSubjectDialog(null)} onSaved={(subject) => { if (subjectDialog === "new") editor.current?.insert({ id: subject.id, kind: "subject", name: subject.name, url: subject.images[0]?.url || "" }); }} />}
        <Modal open={mediaOpen} title={`参考图片 · ${data.assets.length}`} footer={<Button icon={<Plus size={16} />} loading={reading} onClick={() => input.current?.click()}>添加图片</Button>} onCancel={() => setMediaOpen(false)}>
            <div className="grid grid-cols-2 gap-4 py-4 sm:grid-cols-3"><Image.PreviewGroup>{data.assets.map((item) => <div key={item.id} className="relative min-w-0"><Image src={item.url} alt={item.name} className="rounded-lg" style={{ height: 130, width: "100%", objectFit: "contain" }} /><div className="mt-2 truncate text-xs text-muted-foreground" title={item.name}>{item.name}</div><Button type="text" className="!absolute right-0 top-0" aria-label={`移除 ${item.name}`} icon={<X size={16} />} onClick={() => setData((current) => ({ ...current, assets: current.assets.filter((asset) => asset.id !== item.id) }))} /></div>)}</Image.PreviewGroup></div>{!data.assets.length && <Empty description="还没有参考图片" />}
        </Modal>
        <Modal open={Boolean(preview)} title={result ? "视频生成完成" : "正在生成视频"} closable={Boolean(result)} maskClosable={Boolean(result)} onCancel={() => { if (result) setPreview(null); }} footer={result ? <><Button icon={<Download size={16} />} href={result.url} download="ai-video.mp4">下载</Button><Button type="primary" onClick={() => setPreview(null)}>继续创作</Button></> : null}>
            {result ? <video src={result.url} controls className="aspect-video w-full rounded-lg bg-black object-contain" /> : <div className="flex min-h-44 flex-col items-center justify-center gap-3 text-sm text-muted-foreground"><LoaderCircle className="size-7 animate-spin" /><span>模型正在处理主体与参考素材，请稍候</span></div>}
            <p className="text-xs text-muted-foreground">已整理 {preview?.media.length || 0} 份参考资源、{preview?.subjects.length || 0} 个主体，引用关系随本次内容保留。</p>
            <div className="my-5 whitespace-pre-wrap rounded-xl bg-muted/50 p-4 leading-8">{data.parts.map((part, index) => part.id ? <Tag key={index}>{`@${candidates.find((item) => item.id === part.id && item.kind === part.kind)?.name || part.text}`}</Tag> : part.text)}</div>
            <p className="flex items-center gap-2 text-sm"><Check size={16} />Agent 模式 · {data.auto ? "自动生成偏好" : `${data.kind === "image" ? "图片" : "视频"} · ${preference.ratio} · ${preference.quality.toUpperCase()} · ${modelOptionLabel(config, selectedModel)}`}</p>
            <Image.PreviewGroup><div className="flex flex-wrap gap-2">{data.assets.map((item) => <Image key={item.id} src={item.url} alt={item.name} width={70} height={70} style={{ objectFit: "cover" }} />)}</div></Image.PreviewGroup>
            {subjects.filter((subject) => data.parts.some((part) => part.kind === "subject" && part.id === subject.id)).map((subject) => <div key={subject.id} className="mt-4 rounded-xl border border-border p-3"><div className="font-medium">{subject.name}</div><p className="text-sm text-muted-foreground">{subject.description || "未填写描述"}</p><Image.PreviewGroup>{subject.images.map((item) => <Image key={item.id} src={item.url} alt={item.name} width={64} height={64} style={{ objectFit: "cover" }} />)}</Image.PreviewGroup>{subject.voice && <audio controls src={subject.voice.url} className="mt-3 w-full" />}</div>)}
        </Modal>
    </main>;
}
