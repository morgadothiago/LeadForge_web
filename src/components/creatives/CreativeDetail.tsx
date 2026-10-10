"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Ban, Download, Loader2, RotateCcw, Send, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/campaigns/ConfirmDialog";
import { getFormError } from "@/components/campaigns/form-utils";
import { cancelCreative, deleteCreative, getCreative, getCreativeVideoUrl, retryCreative, submitCreative } from "@/lib/actions/creative";
import type { AvatarsAndVoices, CreativeDetailView, CreativeView } from "@/lib/creatives/types";
import { cn } from "@/lib/utils";
import { createPollController, createUrlRenewer, planResume, videoPanelState, type PollController, type PollStatus, type UrlRenewer } from "./creative-lifecycle";
import { CreativeStatusBadge } from "./CreativeStatusBadge";
import { CreativeThumb } from "./CreativeThumb";
import { MockProviderNotice } from "./MockProviderNotice";
import { ASPECT_LABEL, LANGUAGE_LABEL, STATUS_LABEL, actionsFor, formatCents, formatDuration, isMockProvider, progressLabel, shouldPoll } from "./creative-format";

const dateTimeFmt = (d: Date | string | null) => (d ? new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—");

/**
 * SPEC-051b — página do criativo: status/progresso com polling leve (para quando o estado é terminal ou a aba fica
 * oculta), player com URL assinada curta (renovada antes de expirar e ao falhar), download, cancelar, tentar de novo e
 * excluir com confirmação. Regras de negócio/limites vêm do servidor (`_form`), nunca reescritas aqui.
 */
export function CreativeDetail({ initial, info }: { initial: CreativeDetailView; info: AvatarsAndVoices | null }) {
  const router = useRouter();
  const [c, setC] = React.useState<CreativeDetailView>(initial);
  const [busy, setBusy] = React.useState<null | "submit" | "cancel" | "retry" | "delete" | "download">(null);
  const [error, setError] = React.useState<string>();
  const [confirm, setConfirm] = React.useState<null | "delete" | "cancel">(null);
  const acts = actionsFor(c.status);

  const merge = React.useCallback((v: CreativeView) => setC((prev) => ({ ...prev, ...v, jobs: prev.jobs })), []);
  const [pollState, setPollState] = React.useState<PollStatus>("ok");
  const pollRef = React.useRef<PollController | null>(null);

  // Polling leve: só enquanto fila/gerando; backoff em erro (inclusive exceção); pausa com a aba oculta e refresh
  // imediato ao voltar; para em criativo inexistente (excluído em outra aba) ou após erros consecutivos demais.
  const active = shouldPoll(c.status);
  React.useEffect(() => {
    if (!active) return;
    const ctrl = createPollController<CreativeDetailView>({
      fetch: () => getCreative(initial.id),
      isDone: (d) => !shouldPoll(d.status),
      onData: (d) => setC(d),
      onStatus: setPollState,
      isVisible: () => document.visibilityState === "visible",
      subscribeVisibility: (cb) => {
        document.addEventListener("visibilitychange", cb);
        return () => document.removeEventListener("visibilitychange", cb);
      },
    });
    pollRef.current = ctrl;
    ctrl.start();
    return () => {
      ctrl.stop();
      pollRef.current = null;
      setPollState("ok"); // ao encerrar o ciclo, o próximo não herda o banner de 'gave_up'
    };
  }, [active, initial.id]);
  const refresh = React.useCallback(async (): Promise<boolean> => {
    try {
      const res = await getCreative(initial.id);
      if (res.ok) setC(res.data);
      return res.ok;
    } catch {
      return false;
    }
  }, [initial.id]);

  // Player: URL SAS curta, renovada antes de expirar preservando a posição/pausa; erros com teto e backoff.
  const [video, setVideo] = React.useState<{ url?: string; error?: string; loading: boolean }>({ loading: false });
  const videoEl = React.useRef<HTMLVideoElement | null>(null);
  const resume = React.useRef<{ time: number; play: boolean } | null>(null);
  const renewer = React.useRef<UrlRenewer | null>(null);
  const loadUrl = React.useCallback(async () => getCreativeVideoUrl(initial.id), [initial.id]);
  React.useEffect(() => {
    if (!acts.play) return;
    const r = createUrlRenewer({
      getUrl: loadUrl,
      onUrl: (url) => {
        const el = videoEl.current;
        if (el && el.currentSrc) {
          // URL igual à atual não recarrega o <video> (sem loadedmetadata): não deixa snapshot pendente.
          resume.current = el.getAttribute("src") === url ? null : planResume({ currentTime: el.currentTime, paused: el.paused, ended: el.ended });
        }
        setVideo({ url, loading: false });
      },
      onRetrying: () => setVideo((p) => ({ ...p, loading: !p.url })),
      onGaveUp: (errors) =>
        setVideo((p) => ({ ...p, loading: false, error: errors ? getFormError(errors, "Não foi possível carregar o vídeo.") : "Não foi possível carregar o vídeo. Verifique sua conexão e tente de novo." })),
    });
    renewer.current = r;
    r.start();
    return () => {
      r.stop();
      renewer.current = null;
    };
  }, [acts.play, loadUrl]);

  async function run(kind: "submit" | "cancel" | "retry", fn: (id: string) => ReturnType<typeof submitCreative>, ok: string) {
    setBusy(kind);
    setError(undefined);
    const res = await fn(c.id);
    setBusy(null);
    setConfirm(null);
    if (!res.ok) return setError(getFormError(res.errors));
    merge(res.data);
    toast.success(ok);
    void refresh();
  }

  async function onDelete() {
    setBusy("delete");
    setError(undefined);
    const res = await deleteCreative(c.id);
    if (!res.ok) {
      setBusy(null);
      return setError(getFormError(res.errors, "Não foi possível excluir."));
    }
    toast.success("Criativo excluído.");
    router.push("/criativos");
    router.refresh();
  }

  async function onDownload() {
    setBusy("download");
    const res = await loadUrl(); // URL fresca: a do player pode estar perto de expirar
    setBusy(null);
    if (!res.ok) return toast.error(getFormError(res.errors, "Não foi possível baixar o vídeo."));
    const a = document.createElement("a");
    a.href = res.data.url;
    a.download = `${c.title}.mp4`;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  const panel = videoPanelState(video);
  const progress = progressLabel(c);
  const pct = c.job?.progressPct;
  const avatarName = info?.avatars.find((a) => a.id === c.avatarRef)?.name ?? c.avatarRef;
  const voiceName = info?.voices.find((v) => v.id === c.voiceRef)?.name ?? c.voiceRef;
  const message = c.status === "failed" ? (c.error ?? c.job?.errorMessage) : null;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href="/criativos" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden="true" className="size-4" /> Voltar para a biblioteca
      </Link>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="break-words font-heading text-xl font-semibold">{c.title}</h2>
            <CreativeStatusBadge status={c.status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Criado em {dateTimeFmt(c.createdAt)} · {ASPECT_LABEL[c.aspectRatio].name} · {LANGUAGE_LABEL[c.language]}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {acts.submit && (
            <Button onClick={() => run("submit", submitCreative, "Criativo enviado para geração.")} disabled={busy !== null} aria-busy={busy === "submit"}>
              {busy === "submit" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Send aria-hidden="true" />} Enviar para geração
            </Button>
          )}
          {acts.retry && (
            <Button onClick={() => run("retry", retryCreative, "Nova tentativa enviada.")} disabled={busy !== null} aria-busy={busy === "retry"}>
              {busy === "retry" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RotateCcw aria-hidden="true" />} Tentar novamente
            </Button>
          )}
          {acts.cancel && (
            <Button variant="outline" onClick={() => setConfirm("cancel")} disabled={busy !== null}>
              <Ban aria-hidden="true" /> Cancelar geração
            </Button>
          )}
          {acts.play && (
            <Button variant="outline" onClick={onDownload} disabled={busy !== null} aria-busy={busy === "download"}>
              {busy === "download" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Download aria-hidden="true" />} Baixar
            </Button>
          )}
          <Button variant="outline" onClick={() => setConfirm("delete")} disabled={busy !== null} className="text-destructive">
            <Trash2 aria-hidden="true" /> Excluir
          </Button>
        </div>
      </div>

      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        Status do criativo: {STATUS_LABEL[c.status]}
      </p>

      {info && isMockProvider(info.provider) && <MockProviderNotice />}

      {active && pollState === "retrying" && <p className="text-xs text-muted-foreground">Não foi possível atualizar o status agora; tentando de novo...</p>}
      {active && pollState === "gone" && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Este criativo não existe mais (pode ter sido excluído em outra aba). <Link href="/criativos" className="underline">Voltar para a biblioteca</Link>
        </p>
      )}
      {active && pollState === "gave_up" && (
        <p role="alert" className="flex flex-wrap items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Paramos de atualizar o status automaticamente após várias falhas.
          <Button size="sm" variant="outline" onClick={() => { setPollState("ok"); pollRef.current?.restart(); }}>
            Atualizar agora
          </Button>
        </p>
      )}

      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="overflow-hidden p-0">
          {acts.play ? (
            <div className="bg-black">
              {panel === "player" ? (
                <video
                  ref={videoEl}
                  src={video.url}
                  controls
                  preload="metadata"
                  playsInline
                  aria-label={`Vídeo: ${c.title}`}
                  onLoadedMetadata={(e) => {
                    const pending = resume.current;
                    resume.current = null;
                    if (!pending) return;
                    const el = e.currentTarget;
                    if (pending.time > 0) el.currentTime = pending.time;
                    if (pending.play) void el.play().catch(() => undefined);
                  }}
                  onLoadedData={() => renewer.current?.reportPlaybackOk()}
                  onError={() => renewer.current?.reportPlaybackError()}
                  className="mx-auto max-h-[70vh] w-full object-contain"
                />
              ) : (
                <div role="status" className="flex aspect-video items-center justify-center text-sm text-muted-foreground">
                  {panel === "error" ? (
                    <span role="alert" className="flex flex-col items-center gap-2 px-4 text-center text-destructive">
                      {video.error}
                      <Button size="sm" variant="outline" onClick={() => { resume.current = null; setVideo({ loading: true }); renewer.current?.restart(); }}>
                        Tentar de novo
                      </Button>
                    </span>
                  ) : (
                    "Carregando vídeo..."
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 p-8 text-center">
              <CreativeThumb status={c.status} className="h-32 w-full max-w-xs" />
              {shouldPoll(c.status) ? (
                <>
                  <p className="font-medium">{progress}</p>
                  <div
                    role="progressbar"
                    aria-label="Progresso da geração"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={pct != null ? Math.round(pct) : undefined}
                    className="h-2 w-full max-w-xs overflow-hidden rounded-full bg-muted"
                  >
                    <div className={cn("h-full rounded-full bg-primary", pct == null && "w-1/3 animate-pulse")} style={pct != null ? { width: `${Math.round(pct)}%` } : undefined} />
                  </div>
                  <p className="text-xs text-muted-foreground">Você pode sair desta página; a geração continua e o status é atualizado automaticamente.</p>
                </>
              ) : c.status === "failed" ? (
                <p role="alert" className="flex max-w-sm items-start gap-2 text-left text-sm text-destructive">
                  <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                  {message ?? "A geração falhou. Tente novamente."}
                </p>
              ) : c.status === "canceled" ? (
                <p className="text-sm text-muted-foreground">Geração cancelada. Você pode tentar novamente.</p>
              ) : (
                <p className="text-sm text-muted-foreground">Rascunho: ainda não enviado para geração.</p>
              )}
            </div>
          )}
        </Card>

        <Card className="space-y-4 p-5">
          <dl className="grid gap-3 text-sm">
            <Item label="Avatar" value={avatarName} />
            <Item label="Voz" value={voiceName} />
            <Item label="Duração" value={formatDuration(c.durationSec)} />
            <Item label="Enviado em" value={dateTimeFmt(c.submittedAt)} />
            {c.job && <Item label="Custo estimado" value={isMockProvider(info?.provider) ? `${formatCents(0)} (demonstração)` : formatCents(c.job.costEstimateCents)} />}
          </dl>
        </Card>
      </div>

      <Card className="space-y-2 p-5">
        <h3 className="font-heading text-base font-semibold">Roteiro</h3>
        <p className="whitespace-pre-wrap break-words text-sm">{c.script}</p>
      </Card>

      {c.jobs.length > 0 && (
        <Card className="p-5">
          <h3 className="font-heading text-base font-semibold">Histórico de execuções</h3>
          <ul className="mt-3 divide-y divide-border text-sm">
            {c.jobs.map((j) => (
              <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  Execução #{j.runNo} · {dateTimeFmt(j.createdAt)}
                </span>
                <span className="text-muted-foreground">
                  {j.status === "succeeded" ? STATUS_LABEL.ready : j.status === "failed" ? `${STATUS_LABEL.failed}${j.errorMessage ? `: ${j.errorMessage}` : ""}` : j.status === "canceled" ? STATUS_LABEL.canceled : j.status === "processing" ? STATUS_LABEL.processing : STATUS_LABEL.queued}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <ConfirmDialog
        open={confirm === "cancel"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Cancelar a geração?"
        description="A geração será interrompida. Você poderá tentar novamente depois."
        confirmLabel="Cancelar geração"
        destructive
        pending={busy === "cancel"}
        onConfirm={() => run("cancel", cancelCreative, "Geração cancelada.")}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Excluir este criativo?"
        description="O criativo e o vídeo gerado serão removidos e não poderão ser recuperados. A cota já usada no mês não é devolvida."
        confirmLabel="Excluir criativo"
        destructive
        pending={busy === "delete"}
        error={confirm === "delete" ? error : undefined}
        onConfirm={onDelete}
      />
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words font-medium">{value}</dd>
    </div>
  );
}
