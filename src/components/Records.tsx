import { useState } from "react";
import { useStore } from "../store";
import { selectEffectiveRows } from "../domain/selectors";
import { FIELD_LABELS, FIELD_ORDER, ROOM_LEVELS } from "../domain/rules";
import type { FieldKey, FieldVersion, State } from "../types";
import { dispatch } from "../store";
import { Empty, fmtPoint, VerdictBadge, VersionTag } from "./ui";

function ConflictBox({ recordId }: { recordId: string }) {
  const conflicts = useStore((s: State) =>
    Object.values(s.conflicts).filter((c) => c.recordId === recordId),
  );
  const record = useStore((s: State) => s.records[recordId]);
  if (!conflicts.length) return null;

  return (
    <div className="conflict-box">
      {conflicts.map((c) => {
        const versions = c.versionIds
          .map((id) => record.versions.find((v) => v.id === id))
          .filter(Boolean) as FieldVersion[];
        return (
          <div key={c.id} className="conflict-item">
            <div className="conflict-head">
              <b>{FIELD_LABELS[c.field]} 字段冲突</b>
              {c.status === "pending" ? (
                <span className="badge verdict-watch">待复核 · 暂按先到版本</span>
              ) : (
                <span className="badge verdict-ok">
                  已复核{c.winnerId ? `：采用 ${versions.find((v) => v.id === c.winnerId)?.submitter} 版本` : ""}
                </span>
              )}
            </div>
            <div className="version-stack">
              {versions.map((v, i) => (
                <div key={v.id} className={`version-line ${c.winnerId === v.id ? "is-winner" : ""}`}>
                  <VersionTag v={v} />
                  {c.status === "pending" ? (
                    <button
                      className="mini"
                      onClick={() =>
                        dispatch({ type: "RESOLVE_CONFLICT", conflictId: c.id, winnerId: v.id, by: "班组长 周敏" })
                      }
                    >
                      {i === 0 ? "采用先到版本" : "采用此版本"}
                    </button>
                  ) : c.winnerId === v.id ? (
                    <span className="mini-text">✔ 封存留痕版本</span>
                  ) : (
                    <span className="mini-text dim">留痕（{v.state === "superseded" ? "已被取代" : v.state}）</span>
                  )}
                  {v.voidReason ? <em className="void-reason">{v.voidReason}</em> : null}
                </div>
              ))}
            </div>
            {c.note ? <p className="dim small">{c.note}</p> : null}
          </div>
        );
      })}
    </div>
  );
}

function DraftsBox({ recordId }: { recordId: string }) {
  const drafts = useStore((s: State) => s.records[recordId]?.versions.filter((v) => v.state === "draft") ?? []);
  if (!drafts.length) return null;
  return (
    <div className="draft-box">
      <b>后到草稿（两班同点先到已接受）</b>
      {drafts.map((v) => (
        <div key={v.id} className="version-line">
          <VersionTag v={v} />
          <button className="mini" onClick={() => dispatch({ type: "PROMOTE_DRAFT", versionId: v.id, by: "班组长 周敏" })}>
            复核采纳（按合并规则处理）
          </button>
        </div>
      ))}
    </div>
  );
}

export function Records() {
  const rows = useStore(selectEffectiveRows);
  const [room, setRoom] = useState("all");
  const [verdict, setVerdict] = useState("all");
  const rooms = [...new Set(rows.map((r) => r.roomId))];
  const filtered = rows.filter(
    (r) => (room === "all" || r.roomId === room) && (verdict === "all" || r.verdict === verdict),
  );

  return (
    <div className="view-stack">
      <section className="panel filter-bar">
        <label>
          <span>房间 / 区域</span>
          <select value={room} onChange={(e) => setRoom(e.target.value)}>
            <option value="all">全部</option>
            {rooms.map((r) => (
              <option key={r} value={r}>{r}（{ROOM_LEVELS[r] ?? "—"}）</option>
            ))}
          </select>
        </label>
        <label>
          <span>判定</span>
          <select value={verdict} onChange={(e) => setVerdict(e.target.value)}>
            <option value="all">全部</option>
            <option value="normal">正常</option>
            <option value="watch">关注</option>
            <option value="danger">异常</option>
            <option value="void">失效</option>
          </select>
        </label>
        <span className="dim small">每条记录是房间+时间点的合并视图；展开可见全部字段版本与留痕</span>
      </section>

      {filtered.length === 0 ? <Empty text="没有符合筛选的记录" /> : null}
      {filtered.map((r) => (
        <section key={r.recordId} className="panel record-panel">
          <div className="record-main">
            <div className="record-title">
              <h3>{r.roomId}</h3>
              <span className="dim">{ROOM_LEVELS[r.roomId]} · {fmtPoint(r.point)}</span>
              <VerdictBadge verdict={r.verdict} pending={r.pendingReview} />
            </div>
            <div className="field-table">
              {FIELD_ORDER.map((f: FieldKey) => {
                const v = r.fields[f];
                return (
                  <div key={f} className={`field-cell ${v?.state === "void" ? "is-void" : ""}`}>
                    <span>{FIELD_LABELS[f]}</span>
                    <strong>
                      {v ? v.value : "—"}
                    </strong>
                    {v?.state === "void" ? <em className="void-reason">{v.voidReason}</em> : null}
                    {v ? <small className="dim">{v.submitter} · {v.basis === "offline" ? "离线" : "实时"}</small> : null}
                  </div>
                );
              })}
            </div>
            <ul className="reason-list">
              {r.reasons.map((reason, i) => (
                <li key={i}>{reason}</li>
              ))}
            </ul>
            <details>
              <summary>全部版本与留痕（{r.versions.length}）</summary>
              <div className="version-stack">
                {[...r.versions]
                  .sort((a, b) => a.arrivedAt - b.arrivedAt)
                  .map((v) => (
                    <VersionTag key={v.id} v={v} />
                  ))}
              </div>
            </details>
          </div>
          <ConflictBox recordId={r.recordId} />
          <DraftsBox recordId={r.recordId} />
        </section>
      ))}
    </div>
  );
}
