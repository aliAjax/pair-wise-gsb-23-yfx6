export type FieldKey = "particle" | "pressure" | "thermal" | "device";

export const FIELD_ORDER: FieldKey[] = ["particle", "pressure", "thermal", "device"];

export const FIELD_LABELS: Record<FieldKey, string> = {
  particle: "粒子计数",
  pressure: "压差",
  thermal: "温湿度",
  device: "设备状态",
};

export const FIELD_UNITS: Record<FieldKey, string> = {
  particle: "≥0.5µm 个/m³",
  pressure: "Pa",
  thermal: "℃/%",
  device: "",
};

export interface Room {
  id: string;
  cls: string;
}

export const ROOMS: Room[] = [
  { id: "CR-1201", cls: "ISO 5" },
  { id: "CR-2107", cls: "ISO 6" },
  { id: "Y-0302", cls: "黄光区" },
  { id: "CR-3305", cls: "ISO 7" },
];

export const TIME_POINTS = ["2026-10-03 08:00", "2026-10-03 14:00", "2026-10-03 20:00"];
export const SHIFTS = ["早班", "中班", "夜班"];

/** 某一字段的一次填报版本 */
export interface FieldVersion {
  value: string;
  author: string;
  shift: string;
  origin: "online" | "offline";
  seq: number;
}

/** 字段槽位：current 为有效版本，contender 为冲突保留版本 */
export interface FieldSlot {
  current: FieldVersion | null;
  contender: FieldVersion | null;
}

export type Verdict = "正常" | "关注" | "异常" | "待复核" | "需重判";

export interface InspectionRecord {
  id: string; // `${room} @ ${timePoint}`
  room: string;
  cls: string;
  timePoint: string;
  fields: Record<FieldKey, FieldSlot>;
  invalidatedBy: string | null; // 导致失效的设备事件 id
  rejudged: boolean;
  sealedIn: string | null; // 封存批次 id
  sealedVerdict: Verdict | null; // 封存时冻结的判定，之后不再变化
  updatedSeq: number;
}

/** 后到版本：同一时间点只接受先到版本，后到的完整版本保留为草稿 */
export interface DraftRecord {
  id: string;
  checkpointId: string;
  room: string;
  timePoint: string;
  shift: string;
  author: string;
  origin: "online" | "offline";
  fields: Partial<Record<FieldKey, FieldVersion>>;
  reason: string;
  keptSeq: number;
}

export interface DeviceEvent {
  id: string;
  kind: "停机" | "校准";
  device: string;
  rooms: string[];
  from: string;
  to: string;
  note: string;
  seq: number;
}

export interface BatchSnapshot {
  recordId: string;
  verdict: Verdict;
  fields: Record<FieldKey, string>;
}

export interface ReviewBatch {
  id: string;
  title: string;
  recordIds: string[];
  status: "open" | "sealed";
  createdSeq: number;
  sealedSeq: number | null;
  snapshot: BatchSnapshot[] | null;
}

export interface AuditEntry {
  opId: string; // 幂等键：同一操作重复恢复不会产生重复审计
  seq: number;
  kind: string;
  detail: string;
  at: string;
}

export interface AppState {
  records: Record<string, InspectionRecord>;
  drafts: DraftRecord[];
  events: DeviceEvent[];
  batches: ReviewBatch[];
  audit: AuditEntry[];
  seq: number;
}

export interface Submission {
  room: string;
  timePoint: string;
  shift: string;
  author: string;
  origin: "online" | "offline";
  fields: Partial<Record<FieldKey, string>>;
}

export type Op =
  | { opId: string; kind: "submit"; payload: Submission }
  | { opId: string; kind: "device-event"; payload: DeviceEvent }
  | { opId: string; kind: "resolve"; payload: { recordId: string; field: FieldKey; keep: "current" | "contender"; reviewer: string } }
  | { opId: string; kind: "rejudge"; payload: { recordId: string; fields: Partial<Record<FieldKey, string>>; author: string; shift: string } }
  | { opId: string; kind: "create-batch"; payload: { batchId: string; title: string; recordIds: string[] } }
  | { opId: string; kind: "seal-batch"; payload: { batchId: string } }
  | { opId: string; kind: "promote-draft"; payload: { draftId: string; reviewer: string } };
