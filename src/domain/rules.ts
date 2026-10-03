import type {
  FieldKey,
  FieldVersion,
  IsoLevel,
  LogicalRecord,
  RecordJudgment,
  Verdict,
} from "../types";

export const FIELD_ORDER: FieldKey[] = [
  "particle",
  "pressure",
  "tempHumidity",
  "equipmentStatus",
  "note",
];

export const FIELD_LABELS: Record<FieldKey, string> = {
  particle: "粒子计数",
  pressure: "压差",
  tempHumidity: "温湿度",
  equipmentStatus: "设备状态",
  note: "处理备注",
};

export const ROOM_LEVELS: Record<string, IsoLevel> = {
  "CR-1201": "ISO 5",
  "CR-2107": "ISO 6",
  "CR-3310": "ISO 7",
  "Y-0302": "黄光区",
};

export const LEVEL_LIMITS: Record<IsoLevel, number> = {
  "ISO 5": 3520,
  "ISO 6": 35200,
  "ISO 7": 352000,
  // 黄光区按 ISO 7 管控
  黄光区: 352000,
};

export const VERDICT_LABELS: Record<Verdict, string> = {
  normal: "正常",
  watch: "关注",
  danger: "异常",
  void: "失效",
};

/** 解析 "4180 颗/m³" 形式的粒子计数 */
export function parseParticle(value: string): number | null {
  const m = value.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

export function parsePressure(value: string): number | null {
  const m = value.match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/** 解析 "22.3℃ / 48%RH" */
export function parseTempHumidity(value: string): { temp: number; humidity: number } | null {
  const nums = value.match(/-?\d+(\.\d+)?/g);
  if (!nums || nums.length < 2) return null;
  return { temp: Number(nums[0]), humidity: Number(nums[1]) };
}

/** 同字段冲突时临时先采用先到版本（provisional），判定保持待复核 */
export function effectiveVersions(record: LogicalRecord): Partial<Record<FieldKey, FieldVersion>> {
  const result: Partial<Record<FieldKey, FieldVersion>> = {};
  for (const v of [...record.versions]
    .filter((x) => x.state === "active" || x.state === "void")
    .sort((a, b) => a.arrivedAt - b.arrivedAt)) {
    const cur = result[v.field];
    if (!cur || (cur.state === "void" && v.state !== "void")) {
      result[v.field] = v;
    }
  }
  return result;
}

export function getConflictFields(record: LogicalRecord, conflicts: {
  recordId: string;
  field: FieldKey;
  status: string;
}[]): Set<FieldKey> {
  const set = new Set<FieldKey>();
  for (const c of conflicts) {
    if (c.recordId === record.id && c.status === "pending") set.add(c.field);
  }
  return set;
}

export interface JudgeInput {
  roomId: string;
  point: string;
  versions: FieldVersion[];
  pendingFields: Set<FieldKey>;
}

/**
 * 唯一判定入口：看板 / 记录列表 / 导出共用同一结果。
 * 粒子、压差是关键测量项：被设备事件失效且无新值时，整条记录失效，不再沿用旧值。
 */
export function judge(input: JudgeInput): RecordJudgment {
  const { roomId, versions, pendingFields } = input;
  const reasons: string[] = [];
  const active = effectiveVersions({
    id: `${roomId}|point`,
    roomId,
    point: input.point,
    versions,
    judgment: null as never,
  });

  const particle = active.particle;
  const pressure = active.pressure;
  const th = active.tempHumidity;
  const equip = active.equipmentStatus;
  const level = ROOM_LEVELS[roomId];
  const limit = level ? LEVEL_LIMITS[level] : Infinity;

  let verdict: Verdict = "normal";
  const bump = (next: Verdict) => {
    const order: Verdict[] = ["normal", "watch", "danger"];
    if (order.indexOf(next) > order.indexOf(verdict)) verdict = next;
  };

  // 关键测量项：被设备事件显式作废才判失效（纯缺失不判失效，避免漏测被当作异常关闭）
  const criticalVoid = particle?.state === "void" || pressure?.state === "void";

  if (criticalVoid) {
    const voided: string[] = [];
    const why: string[] = [];
    if (particle?.state === "void") {
      voided.push("粒子计数");
      if (particle.voidReason) why.push(particle.voidReason);
    }
    if (pressure?.state === "void") {
      voided.push("压差");
      if (pressure.voidReason) why.push(pressure.voidReason);
    }
    return {
      verdict: "void",
      reasons: [
        `关键测量项${voided.join("、")}已被设备事件作废`,
        ...why,
        "等待复测补录后重新判定；旧版本不再参与异常统计",
      ],
      pendingReview: false,
      signature: signatureOf(versions, "void", []),
      recomputeSeq: 0,
      computedAt: 0,
    };
  }

  const pv = particle ? parseParticle(particle.value) : null;
  if (pv !== null) {
    if (pv > limit) {
      bump("danger");
      reasons.push(`粒子 ${pv.toLocaleString()} 超 ${level} 限值 ${limit.toLocaleString()}`);
    } else if (pv >= limit * 0.8) {
      bump("watch");
      reasons.push(`粒子 ${pv.toLocaleString()} 接近限值（≥80%）`);
    }
  }

  const dp = pressure ? parsePressure(pressure.value) : null;
  if (dp !== null) {
    if (dp < 8 || dp > 25) {
      bump("danger");
      reasons.push(`压差 ${dp}Pa 越出安全区间 8–25Pa`);
    } else if (dp < 10 || dp > 23) {
      bump("watch");
      reasons.push(`压差 ${dp}Pa 接近告警边界（10–23Pa 为稳定区）`);
    }
  }

  if (th) {
    const parsed = parseTempHumidity(th.value);
    if (parsed) {
      const { temp, humidity } = parsed;
      if (temp < 18 || temp > 26 || humidity < 35 || humidity > 65) {
        bump("danger");
        reasons.push(`温湿度 ${temp}℃/${humidity}% 越限`);
      } else if (temp < 20 || temp > 24 || humidity < 40 || humidity > 60) {
        bump("watch");
        reasons.push(`温湿度 ${temp}℃/${humidity}% 接近上限`);
      }
    }
    if (th.state === "void") {
      reasons.push("温湿度读数已失效，仅参考");
    }
  }

  if (equip) {
    if (/停机|故障|维护/.test(equip.value)) {
      bump("danger");
      reasons.push(`设备状态：${equip.value}`);
    } else if (/校准|待机|关注/.test(equip.value)) {
      bump("watch");
      reasons.push(`设备状态：${equip.value}`);
    }
  }

  if (verdict === "normal" && reasons.length === 0) {
    reasons.push("粒子、压差、温湿度均在稳定区间");
  }

  const pending = pendingFields.size > 0;
  if (pending) {
    reasons.push(
      `字段冲突待复核：${[...pendingFields].map((f) => FIELD_LABELS[f]).join("、")}（暂按先到版本）`,
    );
  }

  return {
    verdict,
    reasons,
    pendingReview: pending,
    signature: signatureOf(versions, verdict, [...pendingFields]),
    recomputeSeq: 0,
    computedAt: 0,
  };
}

function signatureOf(versions: FieldVersion[], verdict: Verdict, pending: FieldKey[]): string {
  const live = versions
    .filter((v) => v.state === "active" || v.state === "void")
    .map((v) => `${v.field}:${v.id}:${v.state}${v.state === "void" ? "@" + (v.voidAt ?? 0) : ""}`)
    .sort()
    .join("|");
  return `${verdict}::${pending.sort().join(",")}::${live}`;
}

/** 看板/列表/导出统一行模型 */
export interface EffectiveRow {
  recordId: string;
  roomId: string;
  point: string;
  verdict: Verdict;
  reasons: string[];
  pendingReview: boolean;
  fields: Partial<Record<FieldKey, FieldVersion>>;
  versions: FieldVersion[];
}

export function toEffectiveRow(
  record: LogicalRecord,
  conflicts: { recordId: string; field: FieldKey; status: string }[],
): EffectiveRow {
  const pendingFields = getConflictFields(record, conflicts);
  const j = judge({ roomId: record.roomId, point: record.point, versions: record.versions, pendingFields });
  return {
    recordId: record.id,
    roomId: record.roomId,
    point: record.point,
    verdict: j.verdict,
    reasons: j.reasons,
    pendingReview: j.pendingReview,
    fields: effectiveVersions(record),
    versions: record.versions,
  };
}
