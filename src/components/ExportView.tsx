import { useState } from "react";
import { useStore } from "../store";
import { exportPayload, selectConsistencyHash } from "../domain/selectors";
import { FIELD_LABELS } from "../domain/rules";
import { fmtPoint, VerdictBadge } from "./ui";

function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ExportView() {
  const payload = useStore(exportPayload);
  const hash = useStore(selectConsistencyHash);
  const [tab, setTab] = useState<"preview" | "csv" | "json">("preview");

  return (
    <div className="view-stack">
      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">导出</p>
            <h2>当天批次有效判定</h2>
          </div>
          <div className="actions">
            <span className="hash-chip">判定指纹 <code>{hash}</code></span>
            <button onClick={() => download(`inspection-${new Date().toISOString().slice(0, 10)}.csv`, payload.csv, "text/csv;charset=utf-8")}>
              下载 CSV
            </button>
            <button
              className="primary-action"
              onClick={() => download(`inspection-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2), "application/json")}
            >
              下载 JSON（含封存快照）
            </button>
          </div>
        </div>
        <ul className="rule-list">
          <li>导出与看板、记录列表共用 <code>selectEffectiveRows</code> 同一投影：同一条记录在三处永远显示同一有效判定（指纹一致）。</li>
          <li>失效字段以版本状态标注，不作为异常统计；封存批次快照原样导出，保留历史判定。</li>
        </ul>
        <div className="tabs">
          {(["preview", "csv", "json"] as const).map((t) => (
            <button key={t} className={tab === t ? "tab active" : "tab"} onClick={() => setTab(t)}>
              {t === "preview" ? "记录预览" : t.toUpperCase()}
            </button>
          ))}
        </div>

        {tab === "preview" ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>房间</th><th>时间点</th><th>判定</th>
                <th>{FIELD_LABELS.particle}</th><th>{FIELD_LABELS.pressure}</th>
                <th>{FIELD_LABELS.tempHumidity}</th><th>{FIELD_LABELS.equipmentStatus}</th>
              </tr>
            </thead>
            <tbody>
              {payload.effectiveRows.map((r) => (
                <tr key={r.recordId}>
                  <td>{r.roomId}</td>
                  <td>{fmtPoint(r.point)}</td>
                  <td><VerdictBadge verdict={r.verdict} pending={r.pendingReview} /></td>
                  <td>{r.fields.particle?.value ?? "—"}</td>
                  <td>{r.fields.pressure?.value ?? "—"}</td>
                  <td>{r.fields.tempHumidity?.value ?? "—"}</td>
                  <td>{r.fields.equipmentStatus?.value ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : tab === "csv" ? (
          <pre className="code-block">{payload.csv}</pre>
        ) : (
          <pre className="code-block">{JSON.stringify({ generatedAt: payload.generatedAt, consistencyHash: payload.consistencyHash, rows: payload.effectiveRows.length, sealedBatches: payload.sealedBatches.length }, null, 2)}</pre>
        )}
      </section>
    </div>
  );
}
