import { dispatch, useStore } from "../store";
import {
  scenarioFailedPacket,
  scenarioMergePackets,
  scenarioRacePackets,
  scenarioRemeasurePacket,
} from "../domain/seed";
import type { AuditType, State } from "../types";
import { Empty } from "./ui";

const AUDIT_LABELS: Record<AuditType, string> = {
  "wave.merged": "批次合并",
  "entry.accepted": "接受版本",
  "entry.duplicate": "重复忽略",
  "entry.draft": "转草稿",
  "entry.autoVoid": "自动失效",
  "conflict.opened": "冲突开启",
  "conflict.resolved": "冲突裁决",
  "draft.promoted": "草稿采纳",
  "judgment.changed": "重新判定",
  "device.event": "设备事件",
  "record.void": "记录失效",
  "anomaly.closed": "异常关闭",
  "batch.created": "批次创建",
  "batch.sealed": "批次封存",
  "sync.failed": "写盘失败",
  "sync.resumed": "恢复补写",
  "sync.completed": "同步完成",
  "state.reset": "重置",
};

const AUDIT_TONE: Partial<Record<AuditType, string>> = {
  "sync.failed": "verdict-danger",
  "entry.autoVoid": "verdict-watch",
  "record.void": "verdict-watch",
  "anomaly.closed": "verdict-ok",
  "conflict.opened": "verdict-watch",
  "batch.sealed": "verdict-ok",
  "sync.resumed": "verdict-ok",
};

function ScenarioButton({ k, label, desc, run }: { k: string; label: string; desc: string; run: () => void }) {
  const used = useStore((s: State) => !!s.scenariosUsed[k]);
  return (
    <div className={`scenario ${used ? "used" : ""}`}>
      <div>
        <b>{label}</b>
        <p className="dim small">{desc}</p>
      </div>
      <button
        disabled={used}
        onClick={() => {
          run();
          dispatch({ type: "MARK_SCENARIO", key: k });
        }}
      >
        {used ? "已演示（重置后可再用）" : "执行"}
      </button>
    </div>
  );
}

export function Sync() {
  const sessions = useStore((s: State) => s.sessions);
  const audit = useStore((s: State) => s.audit);
  const failAfter = useStore((s: State) => s.settings.failAfter);

  return (
    <div className="view-stack">
      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">离线同步演练</p>
            <h2>场景按钮（均走真实合并管线）</h2>
          </div>
          <button onClick={() => dispatch({ type: "RESET" })}>重置演示数据</button>
        </div>
        <div className="scenario-grid">
          <ScenarioButton
            k="merge"
            label="① 同房间两人离线：字段合并 + 同字段冲突"
            desc="李航录粒子/压差，王珂录温湿度并给出不同压差 → CR-1201 16:00 合并，压差两版并存待复核"
            run={() =>
              dispatch({ type: "SUBMIT_WAVE", packets: scenarioMergePackets(), label: "场景①离线合并" })
            }
          />
          <ScenarioButton
            k="race"
            label="② 两班同一时间点提交"
            desc="白班先到接受 CR-2107 20:00，夜班整条保留草稿，可在记录列表复核采纳"
            run={() => dispatch({ type: "SUBMIT_WAVE", packets: scenarioRacePackets(), label: "场景②两班撞点" })}
          />
          <ScenarioButton
            k="calibration"
            label="③ 设备校准 + 复测关闭异常"
            desc="先在「设备事件」把 PC-01 登记校准（12:30 前读数失效 → 12:00 异常重判/失效），再执行本按钮复测，异常关闭且封存快照不变"
            run={() => dispatch({ type: "SUBMIT_WAVE", packets: [scenarioRemeasurePacket()], label: "场景③校准后复测" })}
          />
          <ScenarioButton
            k="fail"
            label="④ 写盘失败 → 恢复只补未完成"
            desc={`当前失败注入点：第 ${failAfter || "—"} 条后失败。执行后到「未完成会话」点恢复，观察审计不重复`}
            run={() =>
              dispatch({ type: "SUBMIT_WAVE", packets: [scenarioFailedPacket()], label: "场景④写盘失败" })
            }
          />
        </div>
        <label className="inline-control">
          <span>失败注入：每批写入第</span>
          <input
            type="number"
            min={0}
            max={20}
            value={failAfter}
            onChange={(e) => dispatch({ type: "SET_FAIL_AFTER", value: Number(e.target.value) })}
          />
          <span>条后失败（0 = 关闭注入）。场景④建议设为 2。</span>
        </label>
      </section>

      <section className="panel">
        <p className="eyebrow">写盘会话</p>
        {sessions.length === 0 ? <Empty text="尚无写盘会话（执行场景④生成）" /> : (
          <table className="data-table">
            <thead>
              <tr><th>会话</th><th>批次</th><th>进度</th><th>状态</th><th>错误</th><th></th></tr>
            </thead>
            <tbody>
              {[...sessions].reverse().map((s) => (
                <tr key={s.id} className={s.status === "failed" ? "row-failed" : ""}>
                  <td>{s.id}</td>
                  <td>{s.packet.label}<div className="dim small">{s.packet.submitter} · {s.packet.id}</div></td>
                  <td>{s.applied}/{s.packet.entries.length}</td>
                  <td>
                    <span className={`badge ${s.status === "failed" ? "verdict-danger" : "verdict-ok"}`}>
                      {s.status === "failed" ? "未完成" : "已完成"}
                    </span>
                  </td>
                  <td className="dim small">{s.error ?? "—"}</td>
                  <td>
                    {s.status === "failed" ? (
                      <button
                        className="primary-action"
                        onClick={() => dispatch({ type: "RECOVER_SESSION", sessionId: s.id })}
                      >
                        从完整批次恢复（补第 {s.applied + 1}–{s.packet.entries.length} 条）
                      </button>
                    ) : (
                      <span className="dim small">恢复于 #{s.finishedAt}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">审计追踪</p>
            <h2>不可变事件日志（{audit.length}）</h2>
          </div>
        </div>
        <div className="audit-log">
          {audit.length === 0 ? <Empty text="无审计" /> : (
            [...audit].reverse().map((a) => (
              <div key={a.seq} className="audit-row">
                <span className="audit-seq">#{a.seq}</span>
                <span className={`badge ${AUDIT_TONE[a.type] ?? "badge-plain"}`}>{AUDIT_LABELS[a.type]}</span>
                <span className="audit-msg">{a.message}</span>
                <span className="dim small audit-key" title={a.key}>{a.key.split(":").slice(0, 2).join(":")}</span>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
