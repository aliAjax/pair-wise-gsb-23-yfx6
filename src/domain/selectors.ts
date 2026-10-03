import type { FieldVersion, ReviewBatch, State, Verdict } from "../types";
import { toEffectiveRow, type EffectiveRow } from "./rules";

/** 看板 / 记录列表 / 导出共用的唯一有效判定投影 */
export function selectEffectiveRows(state: State): EffectiveRow[] {
  return Object.values(state.records)
    .map((r) => toEffectiveRow(r, Object.values(state.conflicts)))
    .sort((a, b) => (a.roomId === b.roomId ? a.point.localeCompare(b.point) : a.roomId.localeCompare(b.roomId)));
}

export interface DashboardStats {
  total: number;
  normal: number;
  watch: number;
  danger: number;
  void: number;
  pendingReview: number;
  drafts: number;
  openBatches: number;
  failedSessions: number;
  activeAnomalies: { roomId: string; point: string; reasons: string[] }[];
}

export function selectDashboard(state: State): DashboardStats {
  const rows = selectEffectiveRows(state);
  const stats: DashboardStats = {
    total: rows.length,
    normal: rows.filter((r) => r.verdict === "normal").length,
    watch: rows.filter((r) => r.verdict === "watch").length,
    danger: rows.filter((r) => r.verdict === "danger").length,
    void: rows.filter((r) => r.verdict === "void").length,
    pendingReview: rows.filter((r) => r.pendingReview).length,
    drafts: Object.values(state.records).reduce(
      (n, r) => n + r.versions.filter((v) => v.state === "draft").length,
      0,
    ),
    openBatches: state.batches.filter((b) => b.status === "open").length,
    failedSessions: state.sessions.filter((s) => s.status === "failed").length,
    activeAnomalies: rows
      .filter((r) => r.verdict === "danger")
      .map((r) => ({ roomId: r.roomId, point: r.point, reasons: r.reasons })),
  };
  return stats;
}

/** 封存批次统计（只读快照，不受后续设备事件影响） */
export function selectSealedSummary(state: State) {
  return state.batches
    .filter((b) => b.status === "sealed" && b.snapshot)
    .map((b) => ({ id: b.id, title: b.title, sealedBy: b.snapshot!.sealedBy, sealedAt: b.snapshot!.sealedAt, summary: b.snapshot!.summary }));
}

export function allVersions(state: State): FieldVersion[] {
  return Object.values(state.records).flatMap((r) => r.versions);
}

/** 三处视图（看板 / 列表 / 导出）的一致性指纹：同一份有效判定哈希 */
export function selectConsistencyHash(state: State): string {
  const rows = selectEffectiveRows(state);
  const body = rows.map((r) => `${r.recordId}=${r.verdict}:${r.reasons.length}:${r.pendingReview ? 1 : 0}`).join("|");
  const sealed = state.batches
    .filter((b) => b.status === "sealed")
    .map((b) => `${b.id}=${JSON.stringify(b.snapshot?.summary)}`)
    .join("|");
  let h = 5381;
  const s = body + "#" + sealed;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return ("00000000" + (h >>> 0).toString(16)).slice(-8);
}

export function pendingConflictCount(state: State) {
  return Object.values(state.conflicts).filter((c) => c.status === "pending").length;
}

export function exportPayload(state: State) {
  const rows = selectEffectiveRows(state);
  const verdictZh: Record<Verdict, string> = { normal: "正常", watch: "关注", danger: "异常", void: "失效" };
  const csv = [
    "房间,时间点,判定,待复核,粒子计数,压差,温湿度,设备状态,判定依据",
    ...rows.map((r) =>
      [
        r.roomId,
        r.point,
        verdictZh[r.verdict],
        r.pendingReview ? "是" : "否",
        r.fields.particle?.value ?? "",
        r.fields.pressure?.value ?? "",
        r.fields.tempHumidity?.value ?? "",
        r.fields.equipmentStatus?.value ?? "",
        r.reasons.join("；"),
      ]
        .map((x) => `"${String(x).replace(/"/g, '""')}"`)
        .join(","),
    ),
  ].join("\n");

  return {
    generatedAt: new Date().toISOString(),
    consistencyHash: selectConsistencyHash(state),
    effectiveRows: rows.map((r) => ({
      recordId: r.recordId,
      roomId: r.roomId,
      point: r.point,
      verdict: r.verdict,
      pendingReview: r.pendingReview,
      reasons: r.reasons,
      fields: Object.fromEntries(
        Object.entries(r.fields).map(([k, v]) => [
          k,
          { value: v!.value, state: v!.state, submitter: v!.submitter, shift: v!.shift, versionId: v!.id, voidReason: v!.voidReason ?? null },
        ]),
      ),
    })),
    sealedBatches: state.batches.filter((b) => b.status === "sealed"),
    csv,
  };
}

export function batchById(state: State, id: string): ReviewBatch | undefined {
  return state.batches.find((b) => b.id === id);
}
