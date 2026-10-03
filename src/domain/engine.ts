import {
  FIELD_LABELS,
  FIELD_ORDER,
  ROOMS,
  type AppState,
  type FieldKey,
  type FieldSlot,
  type FieldVersion,
  type InspectionRecord,
  type Op,
  type Submission,
  type Verdict,
} from "./types";

export type Level = "ok" | "watch" | "bad" | "unknown";

/** ISO 14644-1 ≥0.5µm 粒子浓度上限（个/m³），黄光区按 ISO 6 控制 */
export const PARTICLE_LIMIT: Record<string, number> = {
  "ISO 5": 3520,
  "ISO 6": 35200,
  "ISO 7": 352000,
  "黄光区": 35200,
};

export type AuditSink = (kind: string, detail: string, suffix?: string) => void;

export function checkpointId(room: string, timePoint: string): string {
  return `${room} @ ${timePoint}`;
}

export function roomCls(room: string): string {
  return ROOMS.find((r) => r.id === room)?.cls ?? "ISO 6";
}

function emptySlots(): Record<FieldKey, FieldSlot> {
  return {
    particle: { current: null, contender: null },
    pressure: { current: null, contender: null },
    thermal: { current: null, contender: null },
    device: { current: null, contender: null },
  };
}

export function fieldLevel(key: FieldKey, value: string | null, cls: string): Level {
  if (!value) return "unknown";
  if (key === "particle") {
    const n = Number(value);
    if (!Number.isFinite(n)) return "unknown";
    const limit = PARTICLE_LIMIT[cls] ?? 35200;
    if (n > limit) return "bad";
    if (n > limit * 0.8) return "watch";
    return "ok";
  }
  if (key === "pressure") {
    const n = Number(value);
    if (!Number.isFinite(n)) return "unknown";
    if (n < 5 || n > 20) return "bad";
    if (n < 8 || n > 18) return "watch";
    return "ok";
  }
  if (key === "thermal") {
    const m = value.match(/(-?\d+(?:\.\d+)?)\D+(-?\d+(?:\.\d+)?)/);
    if (!m) return "unknown";
    const t = Number(m[1]);
    const h = Number(m[2]);
    if (t < 18 || t > 26 || h < 35 || h > 60) return "bad";
    if (t < 20 || t > 24 || h < 40 || h > 55) return "watch";
    return "ok";
  }
  if (value.includes("停机")) return "bad";
  if (value.includes("异常") || value.includes("报警")) return "watch";
  return "ok";
}

export function currentValue(rec: InspectionRecord, key: FieldKey): string | null {
  return rec.fields[key].current?.value ?? null;
}

export function hasConflict(rec: InspectionRecord): boolean {
  return FIELD_ORDER.some((k) => rec.fields[k].contender !== null);
}

export function baseVerdict(rec: InspectionRecord): Verdict {
  let watch = false;
  for (const k of FIELD_ORDER) {
    const level = fieldLevel(k, currentValue(rec, k), rec.cls);
    if (level === "bad") return "异常";
    if (level === "watch") watch = true;
  }
  return watch ? "关注" : "正常";
}

/**
 * 有效判定的唯一来源：看板、记录列表、导出都必须走这里。
 * 优先级：封存快照 > 设备事件失效（需重判）> 字段冲突（待复核）> 阈值判定。
 */
export function effectiveVerdict(rec: InspectionRecord): Verdict {
  if (rec.sealedVerdict) return rec.sealedVerdict;
  if (rec.invalidatedBy && !rec.rejudged) return "需重判";
  if (hasConflict(rec)) return "待复核";
  return baseVerdict(rec);
}

export function applyOp(state: AppState, op: Op, audit: AuditSink): void {
  switch (op.kind) {
    case "submit":
      return applySubmission(state, op.payload, audit);
    case "device-event":
      return applyDeviceEvent(state, op.payload, audit);
    case "resolve":
      return applyResolve(state, op.payload, audit);
    case "rejudge":
      return applyRejudge(state, op.payload, audit);
    case "create-batch":
      return applyCreateBatch(state, op.payload, audit);
    case "seal-batch":
      return applySealBatch(state, op.payload, audit);
    case "promote-draft":
      return applyPromoteDraft(state, op.payload, audit);
  }
}

function keepDraft(
  state: AppState,
  rec: InspectionRecord,
  sub: Submission,
  reason: string,
  audit: AuditSink,
): void {
  const seq = ++state.seq;
  const fields: Partial<Record<FieldKey, FieldVersion>> = {};
  for (const k of FIELD_ORDER) {
    const v = sub.fields[k];
    if (v !== undefined && v !== "") {
      fields[k] = { value: v, author: sub.author, shift: sub.shift, origin: sub.origin, seq };
    }
  }
  const draftId = `DRAFT-${seq}`;
  state.drafts.push({
    id: draftId,
    checkpointId: rec.id,
    room: rec.room,
    timePoint: rec.timePoint,
    shift: sub.shift,
    author: sub.author,
    origin: sub.origin,
    fields,
    reason,
    keptSeq: seq,
  });
  audit("draft-kept", `${rec.id}：${sub.shift} ${sub.author} 的版本未覆盖先到数据，保留为草稿 ${draftId}（${reason}）`);
}

/**
 * 离线/在线补录合并：
 * 1. 按 房间+时间点+字段 合并，互补字段直接并入；
 * 2. 同字段同值为幂等重放，不产生冲突也不重复审计；
 * 3. 同字段不同值保留两版，记录进入待复核；
 * 4. 两班对同一时间点各交了一整套且存在差异：只接受先到版本，后到整套保留为草稿；
 * 5. 已封存记录不再接受合并，补录一律转草稿。
 */
function applySubmission(state: AppState, sub: Submission, audit: AuditSink): void {
  const id = checkpointId(sub.room, sub.timePoint);
  const seq = ++state.seq;
  const originTxt = sub.origin === "offline" ? "离线补录" : "在线录入";
  const mk = (value: string): FieldVersion => ({ value, author: sub.author, shift: sub.shift, origin: sub.origin, seq });
  const incoming = FIELD_ORDER.filter((k) => sub.fields[k] !== undefined && sub.fields[k] !== "");
  if (incoming.length === 0) throw new Error("提交内容为空，未写入任何字段");

  let rec = state.records[id];
  if (!rec) {
    rec = {
      id,
      room: sub.room,
      cls: roomCls(sub.room),
      timePoint: sub.timePoint,
      fields: emptySlots(),
      invalidatedBy: null,
      rejudged: false,
      sealedIn: null,
      sealedVerdict: null,
      updatedSeq: seq,
    };
    for (const k of incoming) rec.fields[k].current = mk(sub.fields[k]!);
    state.records[id] = rec;
    audit("submit-created", `${sub.author}（${sub.shift}，${originTxt}）建立巡检记录 ${id}`);
    return;
  }

  if (rec.sealedIn) {
    keepDraft(state, rec, sub, `记录已封存于 ${rec.sealedIn}，快照不可改`, audit);
    return;
  }

  const filled = FIELD_ORDER.filter((k) => rec.fields[k].current !== null);
  const fullOverlap =
    filled.length > 0 && incoming.length === filled.length && incoming.every((k) => filled.includes(k));
  const differing = incoming.filter((k) => rec.fields[k].current && rec.fields[k].current!.value !== sub.fields[k]);
  const fromOtherShift = filled.some((k) => rec.fields[k].current!.shift !== sub.shift);

  if (fullOverlap && differing.length > 0 && fromOtherShift) {
    keepDraft(state, rec, sub, "两班提交同一时间点，只接受先到版本", audit);
    return;
  }

  for (const k of incoming) {
    const slot = rec.fields[k];
    const v = sub.fields[k]!;
    if (!slot.current) {
      slot.current = mk(v);
      audit("submit-merged", `${id} 字段「${FIELD_LABELS[k]}」并入 ${sub.author}（${sub.shift}）的${originTxt}数据`, `#m:${k}`);
    } else if (slot.current.value === v || slot.contender?.value === v) {
      // 幂等：同一值重复补录（如断网重传）直接跳过
    } else if (!slot.contender) {
      slot.contender = mk(v);
      audit(
        "conflict",
        `${id} 字段「${FIELD_LABELS[k]}」冲突：保留「${slot.current.value}」与「${v}」两版，记录进入待复核`,
        `#c:${k}`,
      );
    } else {
      keepDraft(state, rec, { ...sub, fields: { [k]: v } }, `字段「${FIELD_LABELS[k]}」已存在冲突两版`, audit);
    }
  }
  rec.updatedSeq = seq;
}

/** 设备停机/校准：影响范围内未封存记录失效待重判，已封存快照不改 */
function applyDeviceEvent(state: AppState, ev: AppState["events"][number], audit: AuditSink): void {
  ev.seq = ++state.seq;
  state.events.push(ev);
  audit("device-event", `登记${ev.kind}事件：${ev.device}，影响 ${ev.rooms.join("、")}（${ev.from} ~ ${ev.to}）${ev.note ? `，${ev.note}` : ""}`);
  for (const rec of Object.values(state.records)) {
    if (!ev.rooms.includes(rec.room)) continue;
    if (rec.timePoint < ev.from || rec.timePoint > ev.to) continue;
    if (rec.sealedIn) {
      audit("sealed-skip", `${rec.id} 已封存于 ${rec.sealedIn}，快照不改，跳过本次${ev.kind}影响`, `#skip:${rec.id}`);
      continue;
    }
    rec.invalidatedBy = ev.id;
    rec.rejudged = false;
    rec.updatedSeq = ++state.seq;
    audit("invalidated", `${rec.id} 受${ev.kind}事件（${ev.device}）影响失效，需重新判定`, `#inv:${rec.id}`);
  }
}

function applyResolve(
  state: AppState,
  p: { recordId: string; field: FieldKey; keep: "current" | "contender"; reviewer: string },
  audit: AuditSink,
): void {
  const rec = state.records[p.recordId];
  if (!rec) throw new Error("记录不存在");
  if (rec.sealedIn) throw new Error("记录已封存，不可裁定");
  const slot = rec.fields[p.field];
  if (!slot.contender) throw new Error("该字段没有待复核冲突");
  const kept = p.keep === "contender" ? slot.contender : slot.current!;
  const dropped = p.keep === "contender" ? slot.current! : slot.contender;
  slot.current = kept;
  slot.contender = null;
  rec.updatedSeq = ++state.seq;
  audit(
    "resolve",
    `${p.reviewer} 裁定 ${p.recordId} 字段「${FIELD_LABELS[p.field]}」采用「${kept.value}」（${kept.shift} ${kept.author}），弃用「${dropped.value}」`,
  );
}

/** 重新判定：用复测值整体替换失效字段并清除冲突，记录恢复有效 */
function applyRejudge(
  state: AppState,
  p: { recordId: string; fields: Partial<Record<FieldKey, string>>; author: string; shift: string },
  audit: AuditSink,
): void {
  const rec = state.records[p.recordId];
  if (!rec) throw new Error("记录不存在");
  if (rec.sealedIn) throw new Error("记录已封存，不可重判");
  const seq = ++state.seq;
  const changed: string[] = [];
  for (const k of FIELD_ORDER) {
    const v = p.fields[k];
    if (v === undefined || v === "") continue;
    rec.fields[k].current = { value: v, author: p.author, shift: p.shift, origin: "online", seq };
    rec.fields[k].contender = null;
    changed.push(FIELD_LABELS[k]);
  }
  rec.invalidatedBy = null;
  rec.rejudged = true;
  rec.updatedSeq = seq;
  audit("rejudge", `${p.author} 重新判定 ${p.recordId}（${changed.join("、")}），记录恢复有效`);
}

function applyCreateBatch(
  state: AppState,
  p: { batchId: string; title: string; recordIds: string[] },
  audit: AuditSink,
): void {
  if (state.batches.some((b) => b.id === p.batchId)) throw new Error(`批次 ${p.batchId} 已存在`);
  if (p.recordIds.length === 0) throw new Error("批次内没有记录");
  state.batches.push({
    id: p.batchId,
    title: p.title,
    recordIds: [...p.recordIds],
    status: "open",
    createdSeq: ++state.seq,
    sealedSeq: null,
    snapshot: null,
  });
  audit("batch-created", `创建复核批次 ${p.batchId}「${p.title}」，纳入 ${p.recordIds.length} 条记录`);
}

/** 封存：批次内不得有待复核/需重判记录；封存时冻结每条记录的有效判定快照 */
function applySealBatch(state: AppState, p: { batchId: string }, audit: AuditSink): void {
  const batch = state.batches.find((b) => b.id === p.batchId);
  if (!batch) throw new Error("批次不存在");
  if (batch.status === "sealed") throw new Error("批次已封存");
  const pending = batch.recordIds
    .map((id) => state.records[id])
    .filter((r) => r && (hasConflict(r) || (r.invalidatedBy && !r.rejudged)));
  if (pending.length > 0) {
    throw new Error(`批次内仍有 ${pending.length} 条待复核/需重判记录（${pending.map((r) => r.id).join("、")}），不能封存`);
  }
  const seq = ++state.seq;
  batch.status = "sealed";
  batch.sealedSeq = seq;
  batch.snapshot = [];
  for (const id of batch.recordIds) {
    const rec = state.records[id];
    if (!rec || rec.sealedIn) continue;
    const verdict = effectiveVerdict(rec);
    rec.sealedIn = batch.id;
    rec.sealedVerdict = verdict;
    batch.snapshot.push({
      recordId: id,
      verdict,
      fields: Object.fromEntries(FIELD_ORDER.map((k) => [k, currentValue(rec, k) ?? "—"])) as Record<FieldKey, string>,
    });
  }
  audit("batch-sealed", `复核批次 ${batch.id} 封存，冻结 ${batch.snapshot.length} 条记录快照，后续设备事件不再改动`);
}

/** 草稿并入：把后到版本以冲突版本身份并回原记录，进入待复核 */
function applyPromoteDraft(state: AppState, p: { draftId: string; reviewer: string }, audit: AuditSink): void {
  const idx = state.drafts.findIndex((d) => d.id === p.draftId);
  if (idx < 0) throw new Error("草稿不存在");
  const draft = state.drafts[idx];
  const rec = state.records[draft.checkpointId];
  if (!rec) throw new Error("草稿对应的记录不存在");
  if (rec.sealedIn) throw new Error("记录已封存，草稿不可并入");
  for (const k of FIELD_ORDER) {
    const v = draft.fields[k];
    if (!v) continue;
    const slot = rec.fields[k];
    if (!slot.current) slot.current = v;
    else if (slot.current.value !== v.value && !slot.contender) slot.contender = v;
  }
  state.drafts.splice(idx, 1);
  rec.updatedSeq = ++state.seq;
  audit("draft-promoted", `${p.reviewer} 将草稿 ${draft.id}（${draft.shift} ${draft.author}）并入 ${rec.id}，差异字段进入待复核`);
}
