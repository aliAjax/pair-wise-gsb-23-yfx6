import { useState } from "react";
import { dispatch, useStore } from "../store";
import { FIELD_LABELS } from "../domain/rules";
import { selectDashboard } from "../domain/selectors";
import type { State } from "../types";
import { Empty, fmtPoint, VerdictBadge } from "./ui";

function OpenBatchView({ batchId }: { batchId: string }) {
  const batch = useStore((s: State) => s.batches.find((b) => b.id === batchId)!);
  const state = useStore((s: State) => s);
  const pending = batch.items.filter(
    (i) => i.kind !== "conflict" || s_conflictsPending(state, i.refId),
  );

  return (
    <article className="batch-card">
      <div className="section-heading">
        <div>
          <h3>{batch.title}</h3>
          <p className="dim small">
            {batch.id} · 创建人 {batch.createdBy} · {batch.items.length} 项（冲突 {batch.items.filter((i) => i.kind === "conflict").length} / 异常 {batch.items.filter((i) => i.kind === "anomaly").length}）
          </p>
        </div>
        <div className="actions">
          <span className="badge verdict-ok">进行中</span>
          <button
            className="primary-action"
            disabled={pending.length > 0}
            title={pending.length > 0 ? "仍有冲突未裁决" : "封存当前有效判定快照"}
            onClick={() => dispatch({ type: "SEAL_BATCH", batchId: batch.id, by: "班组长 周敏" })}
          >
            复核完成并封存
          </button>
        </div>
      </div>
      {pending.length > 0 ? (
        <p className="dim small">封存前需先处理 {pending.length} 项未裁决冲突（可在「记录列表」中裁决）。</p>
      ) : null}
      <ul className="batch-items">
        {batch.items.map((item) => {
          if (item.kind === "conflict") {
            const c = state.conflicts[item.refId];
            const rec = c ? state.records[c.recordId] : undefined;
            if (!c || !rec) return <li key={item.refId}>冲突已不存在</li>;
            return (
              <li key={item.refId} className={c.status === "pending" ? "item-pending" : "item-done"}>
                <b>{rec.roomId} {fmtPoint(rec.point)} · {FIELD_LABELS[c.field]}</b>
                {c.status === "pending" ? (
                  <span className="badge verdict-watch">待复核</span>
                ) : (
                  <span className="badge verdict-ok">已裁决{c.winnerId ? `：保留 ${rec.versions.find((v) => v.id === c.winnerId)?.value}` : ""}</span>
                )}
              </li>
            );
          }
          const rec = state.records[item.refId];
          return (
            <li key={item.refId}>
              <b>{rec.roomId} {fmtPoint(rec.point)}</b>
              <VerdictBadge verdict={rec.judgment.verdict} pending={rec.judgment.pendingReview} />
              <span className="dim small">{rec.judgment.reasons[0]}</span>
            </li>
          );
        })}
      </ul>
    </article>
  );
}

function s_conflictsPending(state: State, id: string) {
  return state.conflicts[id]?.status === "pending";
}

function SealedBatchView({ batchId }: { batchId: string }) {
  const batch = useStore((s: State) => s.batches.find((b) => b.id === batchId)!);
  const snap = batch.snapshot!;
  return (
    <article className="batch-card sealed">
      <div className="section-heading">
        <div>
          <h3>🔒 {batch.title}</h3>
          <p className="dim small">
            {batch.id} · {snap.sealedBy} 封存 · 只读快照 · 共 {snap.rows.length} 条
            （正常 {snap.summary.normal} / 关注 {snap.summary.watch} / 异常 {snap.summary.danger} / 失效 {snap.summary.void}）
          </p>
        </div>
      </div>
      <table className="data-table snapshot-table">
        <thead>
          <tr><th>房间</th><th>时间点</th><th>封存时判定</th><th>粒子</th><th>压差</th><th>依据快照</th></tr>
        </thead>
        <tbody>
          {snap.rows.map((r) => (
            <tr key={r.recordId}>
              <td>{r.roomId}</td>
              <td>{fmtPoint(r.point)}</td>
              <td><VerdictBadge verdict={r.verdict} pending={r.pendingReview} /></td>
              <td>{r.fields.find((f) => f.field === "particle")?.value ?? "—"}</td>
              <td>{r.fields.find((f) => f.field === "pressure")?.value ?? "—"}</td>
              <td className="dim small">{r.reasons.join("；")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </article>
  );
}

export function Batches() {
  const batches = useStore((s: State) => [...s.batches].reverse());
  const pendingCount = useStore((s: State) => Object.values(s.conflicts).filter((c) => c.status === "pending").length);
  const dangerCount = useStore((s: State) => selectDashboard(s).danger);
  const [title, setTitle] = useState("");

  return (
    <div className="view-stack">
      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">复核批次</p>
            <h2>创建当天批次</h2>
          </div>
        </div>
        <p className="dim">
          自动收录当前所有待裁决字段冲突与活动异常：待复核 {pendingCount} 项 · 活动异常 {dangerCount} 条。
          冲突全部裁决后方可封存；封存为只读快照，设备停机/校准与复测重判均不改写。
        </p>
        <div className="btn-row">
          <input
            placeholder="批次标题，例如 10-03 夜班复核批次"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <button
            className="primary-action"
            disabled={pendingCount + dangerCount === 0}
            onClick={() => {
              dispatch({ type: "CREATE_BATCH", title: title || `复核批次 ${new Date().toLocaleTimeString()}`, by: "班组长 周敏" });
              setTitle("");
            }}
          >
            生成批次
          </button>
        </div>
      </section>

      {batches.length === 0 ? <Empty text="尚无复核批次" /> : null}
      {batches.map((b) => (b.status === "open" ? <OpenBatchView key={b.id} batchId={b.id} /> : <SealedBatchView key={b.id} batchId={b.id} />))}
    </div>
  );
}
