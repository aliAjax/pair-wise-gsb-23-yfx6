import { createInitialState, reducer } from "./src/domain/reducer";
import {
  scenarioFailedPacket,
  scenarioMergePackets,
  scenarioRacePackets,
  scenarioRemeasurePacket,
} from "./src/domain/seed";
import { selectDashboard, selectEffectiveRows, selectSealedSummary } from "./src/domain/selectors";

function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!cond) process.exitCode = 1;
}

// 初始状态
let s = createInitialState();
const sealedBefore = JSON.stringify(selectSealedSummary(s));
const rows0 = selectEffectiveRows(s);
const danger1200 = rows0.find((r) => r.recordId === "CR-1201|2026-10-03T12:00")!;
check("种子: CR-1201 12:00 粒子超限=活动异常", danger1200.verdict === "danger", danger1200.reasons[0]);
check("种子: CR-3310 12:00 设备状态冲突待复核", rows0.some((r) => r.recordId.startsWith("CR-3310") && r.pendingReview));
check("种子: 存在已封存批次", selectSealedSummary(s).length === 1);

// 场景①：字段合并 + 同字段冲突两版
s = reducer(s, { type: "SUBMIT_WAVE", packets: scenarioMergePackets(), label: "场景1" });
let r16 = selectEffectiveRows(s).find((r) => r.recordId === "CR-1201|2026-10-03T16:00")!;
check("① 不同字段合并（温湿度来自王珂）", !!r16.fields.tempHumidity && r16.fields.tempHumidity.submitter.includes("王珂"));
check("① 不同字段合并（粒子来自李航）", !!r16.fields.particle && r16.fields.particle.submitter.includes("李航"));
check("① 同字段冲突两版并存+待复核", r16.pendingReview && r16.versions.filter((v) => v.field === "pressure").length === 2);
check("① 冲突临时采用先到版本 19Pa", r16.fields.pressure?.value === "19 Pa");

// 裁决冲突：采用后到 9Pa
const cid = "CR-1201|2026-10-03T16:00|pressure";
const winner = s.records["CR-1201|2026-10-03T16:00"].versions.find((v) => v.field === "pressure" && v.value.startsWith("9"))!;
s = reducer(s, { type: "RESOLVE_CONFLICT", conflictId: cid, winnerId: winner.id, by: "班组长" });
r16 = selectEffectiveRows(s).find((r) => r.recordId === "CR-1201|2026-10-03T16:00")!;
check("① 裁决后采用 9Pa，旧版被取代但留痕", r16.fields.pressure?.value === "9 Pa" &&
  r16.versions.some((v) => v.field === "pressure" && v.state === "superseded"));
check("① 9Pa 接近告警边界 → 关注", r16.verdict === "watch");

// 场景②：两班撞点，先到接受后到草稿
s = reducer(s, { type: "SUBMIT_WAVE", packets: scenarioRacePackets(), label: "场景2" });
const r20 = selectEffectiveRows(s).find((r) => r.recordId === "CR-2107|2026-10-03T20:00")!;
check("② 先到白班版本生效", r20.fields.particle?.value === "12000 颗/m³" && r20.fields.particle.shift === "A");
check("② 后到夜班整条为草稿", r20.versions.filter((v) => v.shift === "B").every((v) => v.state === "draft"));

// 场景③：设备校准 -> 关联记录失效重判，异常关闭；封存快照不变
const auditBefore = s.audit.length;
const dangerBefore = selectDashboard(s).danger;
s = reducer(s, {
  type: "DEVICE_EVENT", deviceId: "PC-01", eventType: "calibration", at: "2026-10-03T12:30",
  note: "校准偏差偏大",
});
let r12 = selectEffectiveRows(s).find((r) => r.recordId === "CR-1201|2026-10-03T12:00")!;
check("③ 校准后 12:00 旧粒子失效 → 记录判失效", r12.verdict === "void", r12.reasons.join("；"));
check("③ 看板活动异常全部关闭（08:00 已封存异常仍留在快照里）", selectDashboard(s).danger === dangerBefore - 2,
  `${dangerBefore} -> ${selectDashboard(s).danger}`);
check("③ 审计包含异常关闭", s.audit.some((a) => a.type === "anomaly.closed"));
check("③ 审计条数增加（设备事件+失效+重判+关异常）", s.audit.length > auditBefore);
const sealedAfter = JSON.stringify(selectSealedSummary(s));
check("③ 封存批次快照完全不变", sealedBefore === sealedAfter);

// 复测补录新粒子 → 重新判定，异常仍关闭
s = reducer(s, { type: "SUBMIT_WAVE", packets: [scenarioRemeasurePacket()], label: "复测" });
r12 = selectEffectiveRows(s).find((r) => r.recordId === "CR-1201|2026-10-03T12:00")!;
check("③ 复测 1980 颗/m³ → 不再异常", r12.verdict !== "danger" && r12.fields.particle?.value === "1980 颗/m³");
check("③ 旧粒子版本仍以失效留痕", r12.versions.some((v) => v.field === "particle" && v.value.startsWith("4180") && v.state === "void"));

// 场景④：写盘失败注入第2条后失败 -> 恢复只补未完成，审计不重复
s = reducer(s, { type: "SET_FAIL_AFTER", value: 2 });
s = reducer(s, { type: "SUBMIT_WAVE", packets: [scenarioFailedPacket()], label: "场景4" });
const session = s.sessions.find((x) => x.status === "failed")!;
check("④ 失败会话保留完整批次且仅落盘2条", !!session && session.applied === 2 && session.packet.entries.length === 5);
const rowsBeforeRecover = selectEffectiveRows(s).length;
const auditKeysBefore = new Set(s.audit.map((a) => a.key));
const auditCountBefore = s.audit.length;
s = reducer(s, { type: "RECOVER_SESSION", sessionId: session.id });
check("④ 恢复后无失败会话", s.sessions.every((x) => x.status === "complete"));
check("④ 恢复补齐了未完成记录", selectEffectiveRows(s).length >= rowsBeforeRecover + 2);
// 再调一次恢复不应有任何效果/重复审计
const auditCountAfter = s.audit.length;
s = reducer(s, { type: "RECOVER_SESSION", sessionId: session.id });
check("④ 重复恢复无新审计（幂等）", s.audit.length === auditCountAfter);
check("④ 恢复阶段无重复幂等键", s.audit.filter((a) => a.type === "entry.accepted").length ===
  new Set(s.audit.filter((a) => a.type === "entry.accepted").map((a) => a.key)).size);
void auditKeysBefore;
void auditCountBefore;

// 一致性：看板/列表/导出同源指纹
const { selectConsistencyHash, exportPayload } = await import("./src/domain/selectors");
const hash = selectConsistencyHash(s);
check("⑤ 导出与看板判定指纹一致", exportPayload(s).consistencyHash === hash, hash);
check("⑤ 导出 CSV 含全部有效行", exportPayload(s).csv.split("\n").length - 1 === selectEffectiveRows(s).length);

console.log("\n审计序列（最后12条）:");
for (const a of s.audit.slice(-12)) console.log(`  #${a.seq} [${a.type}] ${a.message}`);
