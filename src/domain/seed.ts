import { applyOp } from "./engine";
import { TIME_POINTS, type AppState, type Op } from "./types";

const [T1, T2] = [TIME_POINTS[0], TIME_POINTS[1]];

/**
 * 初始演示数据：通过同一套 applyOp 管线生成，审计链路与真实操作一致。
 * 覆盖：正常（已封存）、字段冲突待复核、后到草稿、关注、设备事件失效待重判、封存跳过。
 */
export function seedState(): AppState {
  const state: AppState = { records: {}, drafts: [], events: [], batches: [], audit: [], seq: 0 };
  const ops: Op[] = [
    {
      opId: "seed-1",
      kind: "submit",
      payload: {
        room: "CR-1201", timePoint: T1, shift: "早班", author: "王工", origin: "online",
        fields: { particle: "2100", pressure: "12", thermal: "22.3/45", device: "运行正常" },
      },
    },
    {
      opId: "seed-2",
      kind: "submit",
      payload: {
        room: "CR-2107", timePoint: T1, shift: "早班", author: "王工", origin: "offline",
        fields: { particle: "18200", pressure: "15", thermal: "22.8/47", device: "运行正常" },
      },
    },
    // 中班离线补录同一时间点：粒子计数与早班不一致 → 同字段冲突，保留两版待复核
    {
      opId: "seed-3",
      kind: "submit",
      payload: {
        room: "CR-2107", timePoint: T1, shift: "中班", author: "李工", origin: "offline",
        fields: { particle: "36600", thermal: "22.8/47" },
      },
    },
    // 夜班又提交同一时间点一整套不同数据 → 只接受先到版本，夜班整套保留为草稿
    {
      opId: "seed-4",
      kind: "submit",
      payload: {
        room: "CR-2107", timePoint: T1, shift: "夜班", author: "张工", origin: "offline",
        fields: { particle: "19000", pressure: "14", thermal: "22.9/46", device: "运行正常" },
      },
    },
    {
      opId: "seed-5",
      kind: "submit",
      payload: {
        room: "Y-0302", timePoint: T2, shift: "早班", author: "王工", origin: "online",
        fields: { particle: "9100", pressure: "6", thermal: "24.6/58", device: "异常振动" },
      },
    },
    {
      opId: "seed-6",
      kind: "submit",
      payload: {
        room: "CR-3305", timePoint: T2, shift: "中班", author: "李工", origin: "online",
        fields: { particle: "410000", pressure: "22", thermal: "23.0/50", device: "运行正常" },
      },
    },
    // 粒子计数器校准偏差超限 → CR-3305 14:00 记录失效，需重新判定
    {
      opId: "seed-7",
      kind: "device-event",
      payload: {
        id: "EV-1", kind: "校准", device: "粒子计数器 PC-03", rooms: ["CR-3305"],
        from: T2, to: T2, note: "校准偏差超限，期间数据待重判", seq: 0,
      },
    },
    // 早班记录复核封存
    { opId: "seed-8", kind: "create-batch", payload: { batchId: "RB-1", title: "早班巡检复核", recordIds: [`CR-1201 @ ${T1}`] } },
    { opId: "seed-9", kind: "seal-batch", payload: { batchId: "RB-1" } },
    // 封存后发生停机事件 → 已封存快照不改
    {
      opId: "seed-10",
      kind: "device-event",
      payload: {
        id: "EV-2", kind: "停机", device: "FFU 机组 FFU-12", rooms: ["CR-1201"],
        from: T1, to: T1, note: "机组停机 20 分钟", seq: 0,
      },
    },
  ];
  for (const op of ops) {
    applyOp(state, op, (kind, detail, suffix = "") => {
      const opId = op.opId + suffix;
      if (state.audit.some((a) => a.opId === opId)) return;
      state.audit.push({ opId, kind, detail, seq: ++state.seq, at: "初始化" });
    });
  }
  return state;
}
