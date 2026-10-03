import type {
  Action,
  AuditEntry,
  AuditType,
  BatchItem,
  DeviceEvent,
  FieldConflict,
  FieldKey,
  FieldVersion,
  LogicalRecord,
  OfflinePacket,
  ReviewBatch,
  SnapshotField,
  SnapshotRow,
  State,
  SyncSession,
  Verdict,
} from "../types";
import { effectiveVersions, getConflictFields, judge, toEffectiveRow, VERDICT_LABELS } from "./rules";

export const STORAGE_KEY = "hxwl-09.state.v1";

let clock = 9000;
export function tick() {
  clock += 7;
  return clock;
}
export function resetClock() {
  clock = 9000;
}

function nextId(state: State, prefix: string) {
  state.nextId += 1;
  return `${prefix}-${state.nextId}`;
}

export function audit(state: State, type: AuditType, message: string, key: string) {
  // 幂等键：同一业务事实（如某条 entry.accepted）只记一次，恢复补写不产生重复审计
  if (state.audit.some((a) => a.key === key)) {
    return state.audit.find((a) => a.key === key)!;
  }
  const entry: AuditEntry = { seq: state.audit.length + 1, at: tick(), key, type, message };
  state.audit.push(entry);
  return entry;
}

export function getRecord(state: State, roomId: string, point: string): LogicalRecord {
  const id = `${roomId}|${point}`;
  let rec = state.records[id];
  if (!rec) {
    rec = {
      id,
      roomId,
      point,
      versions: [],
      judgment: {
        verdict: "void",
        reasons: ["尚无数据"],
        pendingReview: false,
        signature: "",
        recomputeSeq: 0,
        computedAt: 0,
      },
    };
    state.records[id] = rec;
  }
  return rec;
}

function conflictList(state: State): FieldConflict[] {
  return Object.values(state.conflicts);
}

/** 设备事件导致的版本失效（停机/校准窗口） */
export function applyDeviceVoid(
  state: State,
  version: FieldVersion,
  evt: { type: DeviceEvent["type"]; at: string; deviceId: string; note: string; id: string },
): boolean {
  if (!version.deviceId || version.deviceId !== evt.deviceId) return false;
  if (version.state === "void" || version.state === "superseded") return false;
  let hit = false;
  let reason = "";
  if (evt.type === "calibration" && version.capturedAt <= evt.at) {
    hit = true;
    reason = `校准 ${evt.at} 前读数按失效处理（${evt.note}）`;
  }
  if (evt.type === "shutdown" && version.capturedAt >= evt.at) {
    hit = true;
    reason = `设备自 ${evt.at} 停机，停机期间读数失效（${evt.note}）`;
  }
  if (evt.type === "restore") {
    // 恢复不自动复活旧数据，恢复后由复测提交新版本
    return false;
  }
  if (!hit) return false;
  version.state = "void";
  version.voidReason = reason;
  version.voidAt = tick();
  audit(state, "entry.autoVoid", `${version.roomId} ${version.point} 字段版本失效：${reason}`, `autovoid:${version.id}:${evt.id}`);
  autoResolveConflictIfLosesActive(state, version);
  return true;
}

/** 若冲突中的一方失效，另一方成为唯一有效值：冲突自动关闭（两版仍留痕） */
function autoResolveConflictIfLosesActive(state: State, loser: FieldVersion) {
  for (const c of Object.values(state.conflicts)) {
    if (c.status !== "pending" || !c.versionIds.includes(loser.id)) continue;
    const rec = state.records[c.recordId];
    const others = c.versionIds
      .map((id) => rec.versions.find((v) => v.id === id)!)
      .filter((v) => v && v.state === "active");
    if (others.length === 1) {
      c.status = "resolved";
      c.winnerId = others[0].id;
      c.resolvedBy = "系统";
      c.resolvedAt = tick();
      c.note = "另一方读数被设备事件失效，系统自动保留唯一有效版本";
      audit(
        state,
        "conflict.resolved",
        `${rec.roomId} ${rec.point} 冲突自动关闭：失效方留痕，保留 ${others[0].submitter} 版本`,
        `conflict:auto:${c.id}:${loser.id}`,
      );
    }
  }
}

/** 重新判定；旧判定为异常而新判定不是异常（且非封存）时关闭异常 */
function recompute(state: State, rec: LogicalRecord, trigger: string): { changed: boolean; closedAnomaly: boolean } {
  const pendingFields = getConflictFields(rec, conflictList(state));
  const next = judge({ roomId: rec.roomId, point: rec.point, versions: rec.versions, pendingFields });
  const before = rec.judgment;
  next.recomputeSeq = before.recomputeSeq + 1;
  next.computedAt = tick();
  const changed = before.signature !== next.signature;
  const closedAnomaly = before.verdict === "danger" && next.verdict !== "danger";
  rec.judgment = next;
  if (changed) {
    audit(
      state,
      "judgment.changed",
      `${rec.roomId} ${rec.point}：${VERDICT_LABELS[before.verdict]} → ${VERDICT_LABELS[next.verdict]}（${trigger}，第 ${next.recomputeSeq} 次判定）`,
      `judge:${rec.id}:${next.signature}`,
    );
  }
  if (closedAnomaly) {
    audit(
      state,
      "anomaly.closed",
      `${rec.roomId} ${rec.point} 异常关闭：依据当前有效版本判定为${VERDICT_LABELS[next.verdict]}，旧版本不再统计`,
      `close:${rec.id}:${next.signature}`,
    );
  }
  return { changed, closedAnomaly };
}

/**
 * 合并一个离线条目（房间 + 时间点 + 字段 为合并键）。
 * - 同字段同值：去重
 * - 同字段不同值且同班：两版并存 → 待复核（先到版临时生效）
 * - 同字段不同值且跨班：按“两班同一时间点先到为准”，后到整条保留草稿
 */
function mergeEntry(state: State, packet: OfflinePacket, inputIndex: number): "accepted" | "duplicate" | "draft" {
  const e = packet.entries[inputIndex];
  const rec = getRecord(state, e.roomId, e.point);

  const sameField = rec.versions.filter((v) => v.field === e.field);
  const activeSameField = sameField.filter((v) => v.state === "active");

  // 跨班抢占：该时间点已有另一班次的先到有效版本（任意字段），后到整条草稿
  const crossShiftWinner = rec.versions.find(
    (v) => v.state === "active" && v.shift !== packet.shift,
  );
  if (crossShiftWinner) {
    saveVersion(state, packet, rec, e, "draft");
    audit(
      state,
      "entry.draft",
      `${e.roomId} ${e.point} ${e.field}：${packet.shift}班后到，${crossShiftWinner.shift}班先到版本已接受，本条保留为草稿`,
      `draft:${packet.id}:${inputIndex}`,
    );
    return "draft";
  }

  // 同值去重（本班或离线补传）
  const dup = activeSameField.find((v) => v.value === e.value);
  if (dup) {
    audit(
      state,
      "entry.duplicate",
      `${e.roomId} ${e.point} ${e.field}：与 ${dup.submitter} 已接受版本一致，按重复提交忽略`,
      `dup:${packet.id}:${inputIndex}:${dup.id}`,
    );
    return "duplicate";
  }

  // 同字段冲突：保留两版，进入待复核
  const clash = activeSameField[0];
  const version = saveVersion(state, packet, rec, e, "active");
  if (clash) {
    const cid = `${rec.id}|${e.field}`;
    let conflict = state.conflicts[cid];
    if (!conflict) {
      conflict = {
        id: cid,
        recordId: rec.id,
        field: e.field,
        versionIds: [clash.id, version.id],
        status: "pending",
      };
      state.conflicts[cid] = conflict;
      audit(
        state,
        "conflict.opened",
        `${e.roomId} ${e.point} ${fieldText(e.field)}：${clash.submitter}=「${clash.value}」与 ${packet.submitter}=「${e.value}」两版并存，进入待复核`,
        `conflict:open:${cid}`,
      );
    } else if (!conflict.versionIds.includes(version.id)) {
      conflict.versionIds.push(version.id);
    }
  } else {
    audit(
      state,
      "entry.accepted",
      `${e.roomId} ${e.point} ${fieldText(e.field)} 接受 ${packet.submitter} 版本「${e.value}」`,
      `accept:${version.id}`,
    );
  }

  // 设备已停机/校准：合并时立即应用失效
  for (const evt of state.deviceEvents) {
    applyDeviceVoid(state, version, evt);
  }
  return "accepted";
}

function saveVersion(
  state: State,
  packet: OfflinePacket,
  rec: LogicalRecord,
  e: OfflinePacket["entries"][number],
  vs: FieldVersion["state"],
): FieldVersion {
  const version: FieldVersion = {
    id: nextId(state, "V"),
    packetId: packet.id,
    roomId: e.roomId,
    point: e.point,
    field: e.field,
    value: e.value,
    submitter: packet.submitter,
    shift: packet.shift,
    capturedAt: e.capturedAt,
    arrivedAt: tick(),
    deviceId: e.deviceId,
    basis: packet.basis,
    state: vs,
  };
  rec.versions.push(version);
  return version;
}

function fieldText(f: FieldKey) {
  return { particle: "粒子", pressure: "压差", tempHumidity: "温湿度", equipmentStatus: "设备状态", note: "备注" }[f];
}

function affectedRecords(state: State, packet: OfflinePacket) {
  const ids = new Set(packet.entries.map((e) => `${e.roomId}|${e.point}`));
  return [...ids].map((id) => state.records[id]).filter(Boolean);
}

function submitWave(state: State, packets: OfflinePacket[], label: string) {
  for (const packet of packets) {
    const failAfter = state.settings.failAfter;
    let applied = 0;
    let failed = false;
    for (let i = 0; i < packet.entries.length; i++) {
      mergeEntry(state, packet, i);
      applied = i + 1;
      // 模拟写盘在第 N 条后失败：已写条目不回滚，会话保留完整批次
      if (failAfter > 0 && applied >= failAfter && i < packet.entries.length - 1) {
        failed = true;
        break;
      }
    }
    for (const rec of affectedRecords(state, packet)) {
      recompute(state, rec, "离线批次合并");
    }
    if (failed) {
      const session: SyncSession = {
        id: nextId(state, "S"),
        packet,
        applied,
        status: "failed",
        failAfter,
        error: `写盘在第 ${applied} 条后失败（模拟磁盘不可用），${packet.entries.length - applied} 条未完成`,
        startedAt: packet.arrivedAt,
      };
      state.sessions.push(session);
      audit(
        state,
        "sync.failed",
        `${label}：${packet.submitter} 批次写盘失败，已落盘 ${applied}/${packet.entries.length}，完整批次保留待恢复`,
        `syncfail:${session.id}`,
      );
      // 一个批次失败后中断本波后续，等待恢复
      break;
    }
    audit(
      state,
      "sync.completed",
      `${label}：${packet.submitter} 的 ${packet.entries.length} 条已全部合并`,
      `synccomplete:${packet.id}`,
    );
  }
  audit(state, "wave.merged", `${label}：按房间 / 时间点 / 字段完成合并`, `wave:${packets.map((p) => p.id).join("+")}`);
}

function recoverSession(state: State, sessionId: string) {
  const session = state.sessions.find((s) => s.id === sessionId);
  if (!session || session.status !== "failed") return;
  const packet = session.packet;
  // 只补未完成记录：已 applied 的条目不重放（其 accept/conflict 审计带幂等键，天然不重复）
  for (let i = session.applied; i < packet.entries.length; i++) {
    mergeEntry(state, packet, i);
  }
  for (const rec of affectedRecords(state, packet)) {
    recompute(state, rec, "写盘失败恢复补录");
  }
  session.status = "complete";
  session.finishedAt = tick();
  session.error = undefined;
  audit(
    state,
    "sync.resumed",
    `${packet.submitter} 批次从完整批次恢复：仅补写第 ${session.applied + 1}–${packet.entries.length} 条未完成记录，审计不重复`,
    `syncrecover:${session.id}`,
  );
}

function resolveConflict(state: State, conflictId: string, winnerId: string, by: string) {
  const c = state.conflicts[conflictId];
  if (!c || c.status !== "pending") return;
  const rec = state.records[c.recordId];
  const winner = rec.versions.find((v) => v.id === winnerId);
  if (!winner) return;
  for (const vid of c.versionIds) {
    const v = rec.versions.find((x) => x.id === vid)!;
    if (vid !== winnerId && v.state === "active") v.state = "superseded";
  }
  c.status = "resolved";
  c.winnerId = winnerId;
  c.resolvedBy = by;
  c.resolvedAt = tick();
  c.note = `${by} 裁决保留 ${winner.submitter}（${winner.shift}班）版本，另一版留痕`;
  audit(
    state,
    "conflict.resolved",
    `${rec.roomId} ${rec.point} ${fieldText(c.field)} 冲突复核：保留「${winner.value}」，另一版标记被取代但可追溯`,
    `conflict:resolve:${c.id}:${winnerId}`,
  );
  recompute(state, rec, "冲突复核裁决");
}

function promoteDraft(state: State, versionId: string, by: string) {
  const version = findVersion(state, versionId);
  if (!version || version.state !== "draft") return;
  const rec = state.records[`${version.roomId}|${version.point}`];

  // 提升草稿仍走字段合并：与当前有效版本同值去重，异值进入冲突待复核
  const fakePacket: OfflinePacket = {
    id: version.packetId + ":promote",
    submitter: version.submitter,
    shift: version.shift,
    basis: version.basis,
    label: "草稿采纳",
    arrivedAt: tick(),
    entries: [
      {
        roomId: version.roomId,
        point: version.point,
        field: version.field,
        value: version.value,
        capturedAt: version.capturedAt,
        deviceId: version.deviceId,
      },
    ],
  };
  version.state = "superseded"; // 原草稿行留痕，新活动版本进入正常合并
  version.voidReason = "已由复核采纳为新版本";
  mergeEntry(state, fakePacket, 0);
  audit(
    state,
    "draft.promoted",
    `${version.roomId} ${version.point} ${fieldText(version.field)} 草稿由 ${by} 采纳，按合并规则处理`,
    `promote:${version.id}`,
  );
  recompute(state, rec, "草稿采纳");
}

function findVersion(state: State, id: string): FieldVersion | undefined {
  for (const rec of Object.values(state.records)) {
    const v = rec.versions.find((x) => x.id === id);
    if (v) return v;
  }
  return undefined;
}

function deviceEvent(
  state: State,
  deviceId: string,
  type: DeviceEvent["type"],
  at: string,
  note: string,
) {
  const device = state.devices.find((d) => d.id === deviceId);
  if (!device) return;
  const evt: DeviceEvent = {
    id: nextId(state, "E"),
    deviceId,
    type,
    at,
    roomId: device.roomId,
    fields: device.fields,
    note,
    appliedAt: tick(),
  };
  state.deviceEvents.push(evt);

  const touched = new Set<LogicalRecord>();
  for (const rec of Object.values(state.records)) {
    for (const v of rec.versions) {
      if (applyDeviceVoid(state, v, evt)) touched.add(rec);
    }
  }
  for (const rec of touched) {
    recompute(state, rec, type === "calibration" ? "设备校准" : "设备停机");
  }

  const label = type === "shutdown" ? "停机" : type === "calibration" ? "校准" : "恢复";
  audit(
    state,
    "device.event",
    `${device.name}（${device.roomId}）登记${label}事件 @${at}：${note}；相关测量记录已失效并重判，封存快照不受影响`,
    `device:${evt.id}`,
  );
}

function createBatch(state: State, title: string, by: string) {
  const items: BatchItem[] = [];
  const rows = Object.values(state.records)
    .map((r) => ({ rec: r, row: toEffectiveRow(r, conflictList(state)) }))
    .filter((x) => x.row.pendingReview || x.row.verdict === "danger");
  for (const { rec } of rows) {
    for (const c of Object.values(state.conflicts)) {
      if (c.recordId === rec.id && c.status === "pending" && !items.some((i) => i.refId === c.id)) {
        items.push({ kind: "conflict", refId: c.id });
      }
    }
    if (!items.some((i) => i.kind === "anomaly" && i.refId === rec.id)) {
      const row = toEffectiveRow(rec, conflictList(state));
      if (row.verdict === "danger") items.push({ kind: "anomaly", refId: rec.id });
    }
  }
  if (items.length === 0) return;
  const batch: ReviewBatch = {
    id: nextId(state, "B"),
    title,
    createdAt: tick(),
    createdBy: by,
    status: "open",
    items,
  };
  state.batches.push(batch);
  audit(
    state,
    "batch.created",
    `复核批次「${title}」创建，含 ${items.length} 项待处理（${items.filter((i) => i.kind === "conflict").length} 冲突 / ${items.filter((i) => i.kind === "anomaly").length} 异常）`,
    `batch:create:${batch.id}`,
  );
}

function snapshotRows(state: State, items: BatchItem[]): SnapshotRow[] {
  const rows: SnapshotRow[] = [];
  for (const item of items) {
    let rec: LogicalRecord | undefined;
    if (item.kind === "anomaly") rec = state.records[item.refId];
    if (item.kind === "conflict") {
      const c = state.conflicts[item.refId];
      rec = c ? state.records[c.recordId] : undefined;
    }
    if (!rec) continue;
    const row = toEffectiveRow(rec, conflictList(state));
    const fields: SnapshotField[] = [];
    for (const f of Object.keys(row.fields) as FieldKey[]) {
      const v = row.fields[f]!;
      fields.push({
        field: f,
        value: v.state === "void" ? `（失效）${v.value}` : v.value,
        versionId: v.id,
        submitter: v.submitter,
        shift: v.shift,
      });
    }
    rows.push({
      recordId: rec.id,
      roomId: rec.roomId,
      point: rec.point,
      verdict: row.verdict,
      reasons: row.reasons,
      pendingReview: row.pendingReview,
      fields,
    });
  }
  return rows;
}

function sealBatch(state: State, batchId: string, by: string) {
  const batch = state.batches.find((b) => b.id === batchId);
  if (!batch || batch.status === "sealed") return;
  const pendingConflict = batch.items.find(
    (i) => i.kind === "conflict" && state.conflicts[i.refId]?.status === "pending",
  );
  if (pendingConflict) return; // 冲突未裁决不可封存
  const rows = snapshotRows(state, batch.items);
  const summary: Record<Verdict, number> = { normal: 0, watch: 0, danger: 0, void: 0 };
  for (const r of rows) summary[r.verdict] += 1;
  batch.status = "sealed";
  batch.snapshot = { sealedAt: tick(), sealedBy: by, rows, summary };
  audit(
    state,
    "batch.sealed",
    `复核批次「${batch.title}」封存：${rows.length} 条判定写入只读快照（异常 ${summary.danger} / 失效 ${summary.void}），后续设备事件与复测不改写`,
    `batch:seal:${batch.id}`,
  );
}

export function reducer(prev: State, action: Action): State {
  if (action.type === "HYDRATE") return action.state;
  const state: State = structuredClone(prev);
  switch (action.type) {
    case "SUBMIT_WAVE": {
      const packets: OfflinePacket[] = action.packets.map((p, i) => ({
        ...p,
        arrivedAt: tick() + i,
      }));
      submitWave(state, packets, action.label);
      break;
    }
    case "RECOVER_SESSION":
      recoverSession(state, action.sessionId);
      break;
    case "RESOLVE_CONFLICT":
      resolveConflict(state, action.conflictId, action.winnerId, action.by);
      break;
    case "PROMOTE_DRAFT":
      promoteDraft(state, action.versionId, action.by);
      break;
    case "DEVICE_EVENT":
      deviceEvent(state, action.deviceId, action.eventType, action.at, action.note);
      break;
    case "CREATE_BATCH":
      createBatch(state, action.title, action.by);
      break;
    case "SEAL_BATCH":
      sealBatch(state, action.batchId, action.by);
      break;
    case "SET_FAIL_AFTER":
      state.settings.failAfter = Math.max(0, Math.round(action.value));
      break;
    case "MARK_SCENARIO":
      state.scenariosUsed[action.key] = true;
      break;
    case "RESET":
      return createInitialState();
  }
  return state;
}

// ---------------------------------------------------------------------------
// 初始演示数据：用动作序列构建，保证与生产路径完全一致
// ---------------------------------------------------------------------------

import { DEVICES, PACKETS_SEED } from "./seed";

export function createInitialState(): State {
  resetClock();
  const state: State = {
    version: 1,
    nextId: 100,
    records: {},
    conflicts: {},
    devices: structuredClone(DEVICES),
    deviceEvents: [],
    sessions: [],
    batches: [],
    audit: [],
    scenariosUsed: {},
    settings: { failAfter: 0 },
  };
  buildSeed(state);
  return state;
}

function buildSeed(state: State) {
  const day = "2026-10-03";
  // 白班两次离线补传：先到先得 + 字段合并 + 一起粒子超限异常
  submitWave(
    state,
    PACKETS_SEED.wave1.map((p, i) => ({ ...p, arrivedAt: tick() + i })),
    "08:00 白班离线补传",
  );
  // 第二次补传：CR-2107 压差不同值 -> 两版并存待复核
  submitWave(
    state,
    PACKETS_SEED.wave2.map((p, i) => ({ ...p, arrivedAt: tick() + i })),
    "09:20 网络恢复二次补传",
  );
  // 班组长复核 CR-2107 压差冲突
  const cid = "CR-2107|2026-10-03T08:00|pressure";
  if (state.conflicts[cid]) {
    const rec = state.records["CR-2107|2026-10-03T08:00"];
    const winner = rec.versions.find(
      (v) => v.field === "pressure" && v.value.startsWith("15"),
    );
    if (winner) resolveConflict(state, cid, winner.id, "班组长 周敏");
  }
  // 当天批次封存（快照之后不随设备事件改变）
  createBatch(state, "10-03 白班复核批次", "班组长 周敏");
  const open = state.batches.find((b) => b.status === "open");
  if (open) sealBatch(state, open.id, "班组长 周敏");

  // 下午的活动数据：CR-1201 12:00 粒子异常（未封存），CR-3310 待复核冲突
  submitWave(
    state,
    PACKETS_SEED.wave3.map((p, i) => ({ ...p, arrivedAt: tick() + i })),
    "12:00 午班离线补传",
  );
  void day;
}
