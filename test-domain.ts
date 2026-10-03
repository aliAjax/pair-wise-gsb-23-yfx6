import { applyOp, effectiveVerdict, hasConflict, currentValue } from "./src/domain/engine";
import { seedState } from "./src/domain/seed";
import { Store, CrashError } from "./src/domain/store";
import { TIME_POINTS, type AppState, type Op } from "./src/domain/types";

const [T1, T2, T3] = TIME_POINTS;
let failures = 0;
function check(name: string, cond: boolean) {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name}`); }
}
function run(state: AppState, op: Op) {
  applyOp(state, op, () => {});
}

// ---------- 1. 种子数据 ----------
const s = seedState();
const R = (id: string) => s.records[id];
check("种子: CR-1201 封存后判定=正常", effectiveVerdict(R(`CR-1201 @ ${T1}`)) === "正常");
check("种子: CR-2107 粒子冲突 → 待复核", effectiveVerdict(R(`CR-2107 @ ${T1}`)) === "待复核");
check("种子: CR-2107 保留两版 18200/36600", currentValue(R(`CR-2107 @ ${T1}`), "particle") === "18200" && R(`CR-2107 @ ${T1}`).fields.particle.contender?.value === "36600");
check("种子: 夜班整套后到 → 草稿", s.drafts.length === 1 && s.drafts[0].shift === "夜班");
check("种子: Y-0302 = 关注", effectiveVerdict(R(`Y-0302 @ ${T2}`)) === "关注");
check("种子: CR-3305 校准事件失效 → 需重判", effectiveVerdict(R(`CR-3305 @ ${T2}`)) === "需重判");
check("种子: RB-1 已封存且快照冻结", s.batches[0].status === "sealed" && s.batches[0].snapshot?.[0].verdict === "正常");
check("种子: 封存记录跳过停机事件", s.audit.some((a) => a.kind === "sealed-skip"));

// ---------- 2. 互补字段合并 + 幂等 ----------
const s2 = seedState();
run(s2, { opId: "t1", kind: "submit", payload: { room: "CR-1201", timePoint: T2, shift: "早班", author: "王工", origin: "offline", fields: { particle: "2000", pressure: "12" } } });
run(s2, { opId: "t2", kind: "submit", payload: { room: "CR-1201", timePoint: T2, shift: "中班", author: "李工", origin: "offline", fields: { thermal: "22.0/45", device: "运行正常" } } });
const rec2 = s2.records[`CR-1201 @ ${T2}`];
check("合并: 互补字段并入同一记录", currentValue(rec2, "thermal") === "22.0/45" && currentValue(rec2, "particle") === "2000");
check("合并: 无冲突 → 正常", effectiveVerdict(rec2) === "正常");
run(s2, { opId: "t3", kind: "submit", payload: { room: "CR-1201", timePoint: T2, shift: "中班", author: "李工", origin: "offline", fields: { thermal: "22.0/45" } } });
check("幂等: 同值重传不产生冲突", !hasConflict(rec2));

// ---------- 3. 同字段冲突 → 裁定 ----------
run(s2, { opId: "t4", kind: "submit", payload: { room: "CR-1201", timePoint: T2, shift: "中班", author: "李工", origin: "offline", fields: { pressure: "25" } } });
check("冲突: 压差保留两版 → 待复核", effectiveVerdict(rec2) === "待复核" && rec2.fields.pressure.contender?.value === "25");
run(s2, { opId: "t5", kind: "resolve", payload: { recordId: rec2.id, field: "pressure", keep: "contender", reviewer: "班组长" } });
check("裁定: 采用补录版 25 → 异常", effectiveVerdict(rec2) === "异常" && currentValue(rec2, "pressure") === "25");

// ---------- 4. 两班同时间点 → 后到草稿 ----------
run(s2, { opId: "t6", kind: "submit", payload: { room: "CR-1201", timePoint: T2, shift: "夜班", author: "张工", origin: "offline", fields: { particle: "9999", pressure: "9", thermal: "23.0/50", device: "待机" } } });
check("两班: 先到版本不被覆盖", currentValue(rec2, "particle") === "2000");
check("两班: 后到整套保留为草稿", s2.drafts.some((d) => d.checkpointId === rec2.id && d.fields.particle?.value === "9999"));
const draftId = s2.drafts.find((d) => d.checkpointId === rec2.id)!.id;
run(s2, { opId: "t7", kind: "promote-draft", payload: { draftId, reviewer: "班组长" } });
check("草稿并入: 差异字段进入待复核", hasConflict(rec2) && rec2.fields.particle.contender?.value === "9999");

// ---------- 5. 设备事件 → 失效 → 重判；封存不改 ----------
run(s2, { opId: "t8", kind: "device-event", payload: { id: "EV-9", kind: "停机", device: "FFU-1", rooms: ["CR-1201"], from: T1, to: T2, note: "", seq: 0 } });
check("事件: 未封存记录失效 → 需重判", effectiveVerdict(rec2) === "需重判");
check("事件: 已封存的 CR-1201@08:00 快照不改", effectiveVerdict(s2.records[`CR-1201 @ ${T1}`]) === "正常" && s2.records[`CR-1201 @ ${T1}`].invalidatedBy === null);
run(s2, { opId: "t9", kind: "rejudge", payload: { recordId: rec2.id, fields: { particle: "2100", pressure: "12", thermal: "22.2/46", device: "运行正常" }, author: "王工", shift: "早班" } });
check("重判: 恢复有效且按新值判定", effectiveVerdict(rec2) === "正常");

// ---------- 6. 批次封存守卫 ----------
const s3 = seedState();
run(s3, { opId: "b1", kind: "create-batch", payload: { batchId: "RB-X", title: "测试", recordIds: [`CR-2107 @ ${T1}`] } });
let threw = false;
try { run(s3, { opId: "b2", kind: "seal-batch", payload: { batchId: "RB-X" } }); } catch { threw = true; }
check("封存守卫: 有待复核记录时不能封存", threw);
run(s3, { opId: "b3", kind: "resolve", payload: { recordId: `CR-2107 @ ${T1}`, field: "particle", keep: "contender", reviewer: "班组长" } });
run(s3, { opId: "b4", kind: "seal-batch", payload: { batchId: "RB-X" } });
check("封存: 裁定后封存成功，判定冻结为异常", s3.batches.find((b) => b.id === "RB-X")?.snapshot?.[0].verdict === "异常");
run(s3, { opId: "b5", kind: "device-event", payload: { id: "EV-10", kind: "校准", device: "PC-03", rooms: ["CR-2107"], from: T1, to: T1, note: "", seq: 0 } });
check("封存后: 设备事件不再改动快照", effectiveVerdict(s3.records[`CR-2107 @ ${T1}`]) === "异常" && s3.records[`CR-2107 @ ${T1}`].invalidatedBy === null);

// ---------- 7. 写盘中断恢复（Store + localStorage 桩） ----------
const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};
const store = new Store();
const ops: Op[] = [
  { opId: "c1", kind: "submit", payload: { room: "CR-1201", timePoint: T3, shift: "夜班", author: "张工", origin: "offline", fields: { particle: "3400", pressure: "11", thermal: "22.1/44", device: "运行正常" } } },
  { opId: "c2", kind: "submit", payload: { room: "CR-2107", timePoint: T3, shift: "夜班", author: "张工", origin: "offline", fields: { particle: "21000", pressure: "13", thermal: "22.5/46", device: "运行正常" } } },
];
store.planCrash(1);
let crashed = false;
try { store.commit(ops); } catch (e) { crashed = e instanceof CrashError; }
check("断点: 第 2 条未落盘即中断", crashed && store.pendingJournal() !== null);
check("断点: 只落盘了第 1 条", !!store.state.records[`CR-1201 @ ${T3}`] && !store.state.records[`CR-2107 @ ${T3}`]);
const auditBefore = store.state.audit.length;
const store2 = new Store(); // 模拟重启 → 构造时自动恢复
check("恢复: 重启后补齐第 2 条", !!store2.state.records[`CR-2107 @ ${T3}`]);
check("恢复: 审计只增不重复", new Set(store2.state.audit.map((a) => a.opId)).size === store2.state.audit.length && store2.state.audit.length > auditBefore);
check("恢复: 恢复后再次 recover 为空操作", store2.recover() === false);
check("恢复: journal 已 committed", store2.pendingJournal() === null);

console.log(failures === 0 ? "\n全部通过" : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
