// 领域模型：巡检记录、设备事件、复核批次、离线同步、审计

export type Shift = "A" | "B";

export type FieldKey =
  | "particle"
  | "pressure"
  | "tempHumidity"
  | "equipmentStatus"
  | "note";

export type IsoLevel = "ISO 5" | "ISO 6" | "ISO 7" | "黄光区";

export type Verdict = "normal" | "watch" | "danger" | "void";

/** 字段版本：同一房间、同一时间点、同一字段的一次提交（先到 / 后到、失效、被裁决均保留） */
export interface FieldVersion {
  id: string;
  packetId: string;
  roomId: string;
  point: string; // 巡检时间点 YYYY-MM-DDTHH:mm
  field: FieldKey;
  value: string;
  submitter: string;
  shift: Shift;
  capturedAt: string; // 离线读数采集时间
  arrivedAt: number; // 到达服务端的逻辑序号（判定先后）
  deviceId?: string;
  basis: "live" | "offline";
  state: "active" | "draft" | "void" | "superseded";
  voidReason?: string;
  voidAt?: number;
}

export interface RecordJudgment {
  verdict: Verdict;
  reasons: string[];
  pendingReview: boolean;
  /** 有效判定指纹：有效版本集合 + 结论变化才变 */
  signature: string;
  recomputeSeq: number;
  computedAt: number;
}

/** 逻辑记录：房间 + 时间点，合并各字段的全部版本，对外只有一条有效判定 */
export interface LogicalRecord {
  id: string; // roomId|point
  roomId: string;
  point: string;
  versions: FieldVersion[];
  judgment: RecordJudgment;
}

export interface FieldConflict {
  id: string; // recordId|field
  recordId: string;
  field: FieldKey;
  versionIds: string[];
  status: "pending" | "resolved";
  winnerId?: string;
  resolvedBy?: string;
  resolvedAt?: number;
  note?: string;
}

export interface EntryInput {
  roomId: string;
  point: string;
  field: FieldKey;
  value: string;
  capturedAt: string;
  deviceId?: string;
}

export interface OfflinePacket {
  id: string;
  submitter: string;
  shift: Shift;
  basis: "live" | "offline";
  label: string;
  arrivedAt: number;
  entries: EntryInput[];
}

export type DeviceKind = "particleCounter" | "pressureGauge" | "tempHumidityMeter";

export interface Device {
  id: string;
  name: string;
  kind: DeviceKind;
  roomId: string;
  fields: FieldKey[];
}

export type DeviceEventType = "shutdown" | "calibration" | "restore";

export interface DeviceEvent {
  id: string;
  deviceId: string;
  type: DeviceEventType;
  at: string;
  roomId: string;
  fields: FieldKey[];
  note: string;
  appliedAt: number;
}

export type BatchItemKind = "conflict" | "anomaly";

export interface BatchItem {
  kind: BatchItemKind;
  refId: string;
}

export interface SnapshotField {
  field: FieldKey;
  value: string;
  versionId: string;
  submitter: string;
  shift: Shift;
}

export interface SnapshotRow {
  recordId: string;
  roomId: string;
  point: string;
  verdict: Verdict;
  reasons: string[];
  pendingReview: boolean;
  fields: SnapshotField[];
}

export interface BatchSnapshot {
  sealedAt: number;
  sealedBy: string;
  rows: SnapshotRow[];
  summary: Record<Verdict, number>;
}

export interface ReviewBatch {
  id: string;
  title: string;
  createdAt: number;
  createdBy: string;
  status: "open" | "sealed";
  items: BatchItem[];
  snapshot?: BatchSnapshot;
}

export interface SyncSession {
  id: string;
  packet: OfflinePacket;
  applied: number;
  status: "failed" | "complete";
  failAfter: number;
  error?: string;
  startedAt: number;
  finishedAt?: number;
}

export type AuditType =
  | "wave.merged"
  | "entry.accepted"
  | "entry.duplicate"
  | "entry.draft"
  | "entry.autoVoid"
  | "conflict.opened"
  | "conflict.resolved"
  | "draft.promoted"
  | "judgment.changed"
  | "device.event"
  | "record.void"
  | "anomaly.closed"
  | "batch.created"
  | "batch.sealed"
  | "sync.failed"
  | "sync.resumed"
  | "sync.completed"
  | "state.reset";

export interface AuditEntry {
  seq: number;
  at: number;
  /** 幂等键：恢复重放时同一业务事实不重复审计 */
  key: string;
  type: AuditType;
  message: string;
}

export interface State {
  version: 1;
  nextId: number;
  records: Record<string, LogicalRecord>;
  conflicts: Record<string, FieldConflict>;
  devices: Device[];
  deviceEvents: DeviceEvent[];
  sessions: SyncSession[];
  batches: ReviewBatch[];
  audit: AuditEntry[];
  scenariosUsed: Record<string, boolean>;
  settings: { failAfter: number };
}

export type Action =
  | { type: "SUBMIT_WAVE"; packets: Omit<OfflinePacket, "arrivedAt">[]; label: string }
  | { type: "RECOVER_SESSION"; sessionId: string }
  | { type: "RESOLVE_CONFLICT"; conflictId: string; winnerId: string; by: string }
  | { type: "PROMOTE_DRAFT"; versionId: string; by: string }
  | {
      type: "DEVICE_EVENT";
      deviceId: string;
      eventType: DeviceEventType;
      at: string;
      note: string;
    }
  | { type: "CREATE_BATCH"; title: string; by: string }
  | { type: "SEAL_BATCH"; batchId: string; by: string }
  | { type: "SET_FAIL_AFTER"; value: number }
  | { type: "MARK_SCENARIO"; key: string }
  | { type: "RESET" }
  | { type: "HYDRATE"; state: State };
