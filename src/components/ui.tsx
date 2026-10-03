import type { ReactNode } from "react";
import type { FieldVersion, Verdict } from "../types";
import { FIELD_LABELS } from "../domain/rules";

export const VERDICT_TEXT: Record<Verdict, string> = {
  normal: "正常",
  watch: "关注",
  danger: "异常",
  void: "失效",
};

export function VerdictBadge({ verdict, pending }: { verdict: Verdict; pending?: boolean }) {
  return (
    <span className={`badge verdict-${verdict}`}>
      {VERDICT_TEXT[verdict]}
      {pending ? " · 待复核" : ""}
    </span>
  );
}

export function Panel({ title, sub, actions, children }: { title: string; sub?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          {sub ? <p className="eyebrow">{sub}</p> : null}
          <h2>{title}</h2>
        </div>
        {actions ? <div className="actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function VersionTag({ v }: { v: FieldVersion }) {
  const cls =
    v.state === "active"
      ? "vtag-active"
      : v.state === "draft"
        ? "vtag-draft"
        : v.state === "void"
          ? "vtag-void"
          : "vtag-superseded";
  const stateText = { active: "有效", draft: "草稿", void: "失效", superseded: "被取代" }[v.state];
  return (
    <span className={`vtag ${cls}`} title={`${v.id} · 采集 ${v.capturedAt} · 到达 #${v.arrivedAt}`}>
      {FIELD_LABELS[v.field]}「{v.value}」— {v.submitter}（{v.shift}班）· {stateText}
      {v.basis === "offline" ? " · 离线" : " · 实时"}
    </span>
  );
}

export function Empty({ text }: { text: string }) {
  return <p className="empty">{text}</p>;
}

export function fmtPoint(p: string) {
  return p.replace("2026-10-03", "10-03").replace("T", " ");
}
