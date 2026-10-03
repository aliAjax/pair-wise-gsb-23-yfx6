import { useMemo, useState, useSyncExternalStore } from "react";
import "./styles.css";
import { currentValue, effectiveVerdict, fieldLevel, hasConflict, PARTICLE_LIMIT } from "./domain/engine";
import { CrashError, Store } from "./domain/store";
import {
  FIELD_LABELS,
  FIELD_ORDER,
  FIELD_UNITS,
  ROOMS,
  SHIFTS,
  TIME_POINTS,
  type FieldKey,
  type InspectionRecord,
  type Op,
  type Verdict,
} from "./domain/types";

const project = {
  id: "hxwl-09",
  port: 5109,
  title: "半导体洁净室巡检",
  subtitle: "离线补录按房间+时间点+字段合并，冲突双版本待复核；设备事件使记录失效重判，复核批次封存快照；写盘断点可恢复，看板 / 列表 / 导出共用同一条有效判定。",
};

const ROLES = ["巡检员", "厂务工程师", "班组长"];
const ROLE_HINT: Record<string, string> = {
  巡检员: "负责离线/在线补录与失效记录重新判定",
  厂务工程师: "负责登记设备停机 / 校准事件",
  班组长: "负责冲突裁定、草稿并入与批次封存",
};
const DEVICE_OPTIONS = ["运行正常", "待机", "异常振动", "停机"];

const verdictClass: Record<Verdict, string> = {
  正常: "v-ok",
  关注: "v-watch",
  异常: "v-bad",
  待复核: "v-review",
  需重判: "v-rejudge",
};

const AUDIT_LABELS: Record<string, string> = {
  "submit-created": "新建记录",
  "submit-merged": "离线合并",
  conflict: "字段冲突",
  "draft-kept": "保留草稿",
  "device-event": "设备事件",
  invalidated: "记录失效",
  "sealed-skip": "封存跳过",
  resolve: "复核裁定",
  rejudge: "重新判定",
  "batch-created": "批次创建",
  "batch-sealed": "批次封存",
  "draft-promoted": "草稿并入",
  recovered: "断点恢复",
};

let opCounter = 0;
const newOpId = () => `op-${Date.now().toString(36)}-${++opCounter}`;

function lifecycleOf(rec: InspectionRecord): string {
  if (rec.sealedIn) return "已封存";
  if (rec.invalidatedBy && !rec.rejudged) return "失效待重判";
  if (hasConflict(rec)) return "待复核";
  return "有效";
}

export default function App() {
  const store = useMemo(() => new Store(), []);
  useSyncExternalStore(store.subscribe, store.getSnapshot);
  const state = store.state;

  const [role, setRole] = useState("巡检员");
  const [clsFilter, setClsFilter] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [showRecovery, setShowRecovery] = useState(true);

  // 补录表单
  const [eRoom, setERoom] = useState(ROOMS[0].id);
  const [eTime, setETime] = useState(TIME_POINTS[0]);
  const [eShift, setEShift] = useState(SHIFTS[0]);
  const [eAuthor, setEAuthor] = useState("王工");
  const [eParticle, setEParticle] = useState("");
  const [ePressure, setEPressure] = useState("");
  const [eThermal, setEThermal] = useState("22.0/45");
  const [eDevice, setEDevice] = useState(DEVICE_OPTIONS[0]);
  const [eOffline, setEOffline] = useState(true);

  // 设备事件表单
  const [evKind, setEvKind] = useState<"停机" | "校准">("停机");
  const [evDevice, setEvDevice] = useState("");
  const [evRooms, setEvRooms] = useState<string[]>([]);
  const [evFrom, setEvFrom] = useState(TIME_POINTS[0]);
  const [evTo, setEvTo] = useState(TIME_POINTS[0]);
  const [evNote, setEvNote] = useState("");

  // 重新判定
  const [rejudgeId, setRejudgeId] = useState<string | null>(null);
  const [rjFields, setRjFields] = useState<Record<FieldKey, string>>({ particle: "", pressure: "", thermal: "", device: DEVICE_OPTIONS[0] });
  const [rjAuthor, setRjAuthor] = useState("王工");

  const run = (fn: () => void) => {
    setMsg(null);
    try {
      fn();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const needRole = (r: string): boolean => {
    if (role === r) return true;
    setMsg(`当前角色为「${role}」，请切换到「${r}」后再操作`);
    return false;
  };

  const records = Object.values(state.records).sort((a, b) =>
    a.timePoint === b.timePoint ? a.room.localeCompare(b.room) : a.timePoint < b.timePoint ? -1 : 1,
  );
  const visible = records.filter((r) => !clsFilter || r.cls === clsFilter);

  const effOf = (r: InspectionRecord) => effectiveVerdict(r);
  const particleBad = records.filter((r) => effOf(r) === "异常" && fieldLevel("particle", currentValue(r, "particle"), r.cls) === "bad").length;
  const pressureBad = records.filter((r) => effOf(r) === "异常" && fieldLevel("pressure", currentValue(r, "pressure"), r.cls) === "bad").length;
  const reviewCnt = records.filter((r) => effOf(r) === "待复核").length;
  const rejudgeCnt = records.filter((r) => effOf(r) === "需重判").length;

  const journal = store.pendingJournal();
  const unsealedIds = records.filter((r) => !r.sealedIn).map((r) => r.id);

  const submitEntry = () => {
    if (!needRole("巡检员")) return;
    if (!Number.isFinite(Number(eParticle)) || eParticle.trim() === "") return setMsg("粒子计数需为数字（≥0.5µm 个/m³）");
    if (!Number.isFinite(Number(ePressure)) || ePressure.trim() === "") return setMsg("压差需为数字（Pa）");
    if (!/\d/.test(eThermal)) return setMsg("温湿度格式示例：22.4/46（℃/%）");
    run(() =>
      store.commit([
        {
          opId: newOpId(),
          kind: "submit",
          payload: {
            room: eRoom,
            timePoint: eTime,
            shift: eShift,
            author: eAuthor || "未署名",
            origin: eOffline ? "offline" : "online",
            fields: { particle: eParticle, pressure: ePressure, thermal: eThermal, device: eDevice },
          },
        },
      ]),
    );
  };

  const submitEvent = () => {
    if (!needRole("厂务工程师")) return;
    if (!evDevice.trim()) return setMsg("请填写设备名称");
    if (evRooms.length === 0) return setMsg("请选择影响房间");
    if (evFrom > evTo) return setMsg("时间范围起点不能晚于终点");
    run(() =>
      store.commit([
        {
          opId: newOpId(),
          kind: "device-event",
          payload: { id: `EV-${state.events.length + 1}`, kind: evKind, device: evDevice.trim(), rooms: evRooms, from: evFrom, to: evTo, note: evNote.trim(), seq: 0 },
        },
      ]),
    );
  };

  const resolve = (recordId: string, field: FieldKey, keep: "current" | "contender") => {
    if (!needRole("班组长")) return;
    run(() => store.commit([{ opId: newOpId(), kind: "resolve", payload: { recordId, field, keep, reviewer: role } }]));
  };

  const startRejudge = (rec: InspectionRecord) => {
    setRejudgeId(rec.id);
    setRjFields({
      particle: currentValue(rec, "particle") ?? "",
      pressure: currentValue(rec, "pressure") ?? "",
      thermal: currentValue(rec, "thermal") ?? "",
      device: currentValue(rec, "device") ?? DEVICE_OPTIONS[0],
    });
  };

  const submitRejudge = () => {
    if (!needRole("巡检员")) return;
    if (!rejudgeId) return;
    if (!Number.isFinite(Number(rjFields.particle)) || !Number.isFinite(Number(rjFields.pressure))) return setMsg("重新判定的粒子计数与压差需为数字");
    const id = rejudgeId;
    run(() => {
      store.commit([{ opId: newOpId(), kind: "rejudge", payload: { recordId: id, fields: rjFields, author: rjAuthor || "未署名", shift: eShift } }]);
      setRejudgeId(null);
    });
  };

  const createBatch = () => {
    if (!needRole("班组长")) return;
    if (unsealedIds.length === 0) return setMsg("没有可复核的未封存记录");
    run(() =>
      store.commit([
        { opId: newOpId(), kind: "create-batch", payload: { batchId: `RB-${state.batches.length + 1}`, title: `当班复核批次 ${TIME_POINTS[0].slice(5, 10)}`, recordIds: unsealedIds } },
      ]),
    );
  };

  const sealBatch = (batchId: string) => {
    if (!needRole("班组长")) return;
    run(() => store.commit([{ opId: newOpId(), kind: "seal-batch", payload: { batchId } }]));
  };

  const promoteDraft = (draftId: string) => {
    if (!needRole("班组长")) return;
    run(() => store.commit([{ opId: newOpId(), kind: "promote-draft", payload: { draftId, reviewer: role } }]));
  };

  const simulateCrash = () => {
    if (store.pendingJournal()) return setMsg("已有未完成批次，请先恢复");
    const ops: Op[] = [
      {
        opId: newOpId(),
        kind: "submit",
        payload: { room: "CR-1201", timePoint: TIME_POINTS[2], shift: "夜班", author: "张工", origin: "offline", fields: { particle: "2600", pressure: "11", thermal: "22.1/44", device: "运行正常" } },
      },
      {
        opId: newOpId(),
        kind: "submit",
        payload: { room: "CR-2107", timePoint: TIME_POINTS[2], shift: "夜班", author: "张工", origin: "offline", fields: { particle: "21000", pressure: "13", thermal: "22.5/46", device: "运行正常" } },
      },
    ];
    store.planCrash(1);
    try {
      store.commit(ops);
    } catch (e) {
      if (e instanceof CrashError) setTimeout(() => location.reload(), 500);
    }
  };

  const exportCsv = () => {
    const header = ["房间", "洁净等级", "时间点", "粒子计数(≥0.5µm 个/m³)", "压差(Pa)", "温湿度(℃/%)", "设备状态", "有效判定", "生命周期", "封存批次"];
    const rows = records.map((rec) => [
      rec.room,
      rec.cls,
      rec.timePoint,
      ...FIELD_ORDER.map((k) => currentValue(rec, k) ?? "—"),
      effectiveVerdict(rec), // 与看板、记录列表同一条有效判定
      lifecycleOf(rec),
      rec.sealedIn ?? "",
    ]);
    const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(",")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `巡检有效判定_${TIME_POINTS[0].slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">{project.id} · port {project.port}</p>
          <h1>{project.title}</h1>
          <p className="subtitle">{project.subtitle}</p>
        </div>
        <div className="stack-card">
          <span>存储与恢复</span>
          <strong>{journal ? `批次 ${journal.batchId} 未完成（${journal.applied.length}/${journal.ops.length}）` : "所有批次已完整落盘"}</strong>
          <div className="btn-row">
            <button onClick={simulateCrash}>模拟异常关闭</button>
            <button onClick={() => run(() => store.recover())} disabled={!journal}>恢复未完成批次</button>
            <button onClick={() => store.reset()}>重置演示数据</button>
          </div>
        </div>
      </section>

      {showRecovery && store.lastRecovery && (
        <div className="banner ok">
          <span>{store.lastRecovery}</span>
          <button className="btn-sm" onClick={() => setShowRecovery(false)}>知道了</button>
        </div>
      )}
      {msg && <div className="banner warn">{msg}</div>}

      <section className="metrics-grid">
        <article className="metric-card">
          <span>粒子异常</span>
          <strong>{particleBad}</strong>
          <em className="metric-sub">超过洁净等级阈值</em>
          <i className="status-danger" />
        </article>
        <article className="metric-card">
          <span>压差异常</span>
          <strong>{pressureBad}</strong>
          <em className="metric-sub">超出 5–20 Pa</em>
          <i className="status-danger" />
        </article>
        <article className="metric-card">
          <span>待复核</span>
          <strong>{reviewCnt}</strong>
          <em className="metric-sub">字段冲突保留两版</em>
          <i className="status-watch" />
        </article>
        <article className="metric-card">
          <span>需重判</span>
          <strong>{rejudgeCnt}</strong>
          <em className="metric-sub">设备事件致失效</em>
          <i className="status-ok" />
        </article>
      </section>

      <section className="workspace">
        <aside className="panel narrow">
          <h2>角色</h2>
          <div className="chips">
            {ROLES.map((r) => (
              <button key={r} className={role === r ? "chip-active" : ""} onClick={() => setRole(r)}>{r}</button>
            ))}
          </div>
          <p className="hint">{ROLE_HINT[role]}</p>
          <h2>筛选</h2>
          <div className="chips muted">
            <button className={clsFilter === null ? "chip-active" : ""} onClick={() => setClsFilter(null)}>全部</button>
            {["ISO 5", "ISO 6", "ISO 7", "黄光区"].map((f) => (
              <button key={f} className={clsFilter === f ? "chip-active" : ""} onClick={() => setClsFilter(clsFilter === f ? null : f)}>{f}</button>
            ))}
          </div>
          <h2>洁净等级阈值</h2>
          <ul className="limit-list">
            {Object.entries(PARTICLE_LIMIT).map(([cls, limit]) => (
              <li key={cls}><b>{cls}</b><span>≥0.5µm ≤ {limit.toLocaleString()} 个/m³</span></li>
            ))}
          </ul>
        </aside>

        <section className="panel">
          <div className="section-heading">
            <div>
              <p>巡检补录（需要角色：巡检员）</p>
              <h2>记录录入</h2>
            </div>
            <label className="check-row">
              <input type="checkbox" checked={eOffline} onChange={(e) => setEOffline(e.target.checked)} />
              离线记录，网络恢复后补录
            </label>
          </div>
          <div className="field-grid">
            <label>
              <span>房间编号</span>
              <select value={eRoom} onChange={(e) => setERoom(e.target.value)}>
                {ROOMS.map((r) => <option key={r.id} value={r.id}>{r.id}（{r.cls}）</option>)}
              </select>
            </label>
            <label>
              <span>时间点</span>
              <select value={eTime} onChange={(e) => setETime(e.target.value)}>
                {TIME_POINTS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label>
              <span>班次</span>
              <select value={eShift} onChange={(e) => setEShift(e.target.value)}>
                {SHIFTS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label>
              <span>巡检员</span>
              <input value={eAuthor} onChange={(e) => setEAuthor(e.target.value)} />
            </label>
            <label>
              <span>粒子计数（≥0.5µm 个/m³）</span>
              <input value={eParticle} onChange={(e) => setEParticle(e.target.value)} placeholder="如 3100" />
            </label>
            <label>
              <span>压差（Pa）</span>
              <input value={ePressure} onChange={(e) => setEPressure(e.target.value)} placeholder="如 12" />
            </label>
            <label>
              <span>温湿度（℃/%）</span>
              <input value={eThermal} onChange={(e) => setEThermal(e.target.value)} placeholder="22.4/46" />
            </label>
            <label>
              <span>设备状态</span>
              <select value={eDevice} onChange={(e) => setEDevice(e.target.value)}>
                {DEVICE_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
          </div>
          <div className="btn-row end">
            <button className="primary-action" onClick={submitEntry}>提交补录（按房间+时间点+字段合并）</button>
          </div>
        </section>
      </section>

      <section className="records panel">
        <div className="section-heading">
          <div>
            <p>有效判定唯一来源：effectiveVerdict</p>
            <h2>巡检记录（{visible.length}）</h2>
          </div>
          <button onClick={exportCsv}>导出有效判定 CSV</button>
        </div>
        <div className="record-list">
          {visible.map((rec) => {
            const eff = effOf(rec);
            const hasOffline = FIELD_ORDER.some((k) => rec.fields[k].current?.origin === "offline");
            return (
              <article key={rec.id} className="record-card">
                <div className="record-head">
                  <div>
                    <h3>{rec.room} <span className="muted">{rec.cls}</span></h3>
                    <p className="muted">{rec.timePoint}</p>
                  </div>
                  <div className="pills">
                    <span className={`pill ${verdictClass[eff]}`}>{eff}</span>
                    {rec.sealedIn && <span className="pill v-sealed">已封存 {rec.sealedIn}</span>}
                    {hasOffline && <span className="pill v-off">含离线补录</span>}
                  </div>
                </div>
                <div className="field-values">
                  {FIELD_ORDER.map((k) => {
                    const slot = rec.fields[k];
                    const lvl = fieldLevel(k, slot.current?.value ?? null, rec.cls);
                    return (
                      <div key={k} className={`fv lv-${lvl}`}>
                        <span>{FIELD_LABELS[k]}{FIELD_UNITS[k] ? ` · ${FIELD_UNITS[k]}` : ""}</span>
                        <strong>{slot.current?.value ?? "—"}</strong>
                        <em>{slot.current ? `${slot.current.shift} · ${slot.current.author} · ${slot.current.origin === "offline" ? "离线" : "在线"}` : "未填报"}</em>
                        {slot.contender && (
                          <div className="conflict-box">
                            <p>冲突版本：<b>{slot.contender.value}</b>（{slot.contender.shift} · {slot.contender.author} · {slot.contender.origin === "offline" ? "离线" : "在线"}）</p>
                            <div className="btn-row">
                              <button className="btn-sm" onClick={() => resolve(rec.id, k, "current")}>保留当前</button>
                              <button className="btn-sm" onClick={() => resolve(rec.id, k, "contender")}>采用补录</button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {rec.invalidatedBy && !rec.rejudged && (
                  <div className="invalidate-bar">
                    <span>因设备事件 {rec.invalidatedBy} 失效，需重新判定后才恢复有效</span>
                    <button className="btn-sm" onClick={() => startRejudge(rec)}>重新判定</button>
                  </div>
                )}
                {rejudgeId === rec.id && (
                  <div className="rejudge-form">
                    <div className="field-grid">
                      <label><span>粒子计数</span><input value={rjFields.particle} onChange={(e) => setRjFields({ ...rjFields, particle: e.target.value })} /></label>
                      <label><span>压差（Pa）</span><input value={rjFields.pressure} onChange={(e) => setRjFields({ ...rjFields, pressure: e.target.value })} /></label>
                      <label><span>温湿度（℃/%）</span><input value={rjFields.thermal} onChange={(e) => setRjFields({ ...rjFields, thermal: e.target.value })} /></label>
                      <label>
                        <span>设备状态</span>
                        <select value={rjFields.device} onChange={(e) => setRjFields({ ...rjFields, device: e.target.value })}>
                          {DEVICE_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
                        </select>
                      </label>
                      <label><span>判定人</span><input value={rjAuthor} onChange={(e) => setRjAuthor(e.target.value)} /></label>
                    </div>
                    <div className="btn-row end">
                      <button className="btn-sm" onClick={() => setRejudgeId(null)}>取消</button>
                      <button className="primary-action" onClick={submitRejudge}>提交重新判定</button>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
          {visible.length === 0 && <p className="hint">该洁净等级下暂无记录</p>}
        </div>
      </section>

      <section className="workspace">
        <section className="panel">
          <div className="section-heading">
            <div>
              <p>设备事件（需要角色：厂务工程师）</p>
              <h2>停机 / 校准登记</h2>
            </div>
          </div>
          <div className="field-grid">
            <label>
              <span>事件类型</span>
              <select value={evKind} onChange={(e) => setEvKind(e.target.value as "停机" | "校准")}>
                <option value="停机">停机</option>
                <option value="校准">校准</option>
              </select>
            </label>
            <label>
              <span>设备名称</span>
              <input value={evDevice} onChange={(e) => setEvDevice(e.target.value)} placeholder="如 粒子计数器 PC-03" />
            </label>
            <label>
              <span>影响起点</span>
              <select value={evFrom} onChange={(e) => setEvFrom(e.target.value)}>
                {TIME_POINTS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label>
              <span>影响终点</span>
              <select value={evTo} onChange={(e) => setEvTo(e.target.value)}>
                {TIME_POINTS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
          </div>
          <div className="check-row wrap">
            <span className="hint">影响房间：</span>
            {ROOMS.map((r) => (
              <label key={r.id} className="check-row">
                <input
                  type="checkbox"
                  checked={evRooms.includes(r.id)}
                  onChange={(e) => setEvRooms(e.target.checked ? [...evRooms, r.id] : evRooms.filter((x) => x !== r.id))}
                />
                {r.id}
              </label>
            ))}
          </div>
          <label>
            <span>备注</span>
            <input value={evNote} onChange={(e) => setEvNote(e.target.value)} placeholder="如 校准偏差超限，期间数据待重判" />
          </label>
          <div className="btn-row end">
            <button className="primary-action" onClick={submitEvent}>登记事件（未封存记录失效待重判）</button>
          </div>
          <div className="event-list">
            {state.events.map((ev) => (
              <div key={ev.id} className="event-item">
                <span className={`pill ${ev.kind === "停机" ? "v-bad" : "v-review"}`}>{ev.kind}</span>
                <div>
                  <b>{ev.id} · {ev.device}</b>
                  <p className="muted">{ev.rooms.join("、")} · {ev.from} ~ {ev.to}{ev.note ? ` · ${ev.note}` : ""}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="section-heading">
            <div>
              <p>复核批次（需要角色：班组长）</p>
              <h2>复核与封存</h2>
            </div>
            <button className="primary-action" onClick={createBatch}>将未封存记录生成复核批次</button>
          </div>
          <div className="batch-list">
            {state.batches.map((b) => (
              <div key={b.id} className="batch-card">
                <div className="record-head">
                  <div>
                    <h3>{b.id} · {b.title}</h3>
                    <p className="muted">{b.recordIds.length} 条记录</p>
                  </div>
                  <div className="pills">
                    <span className={`pill ${b.status === "sealed" ? "v-sealed" : "v-review"}`}>{b.status === "sealed" ? "已封存" : "复核中"}</span>
                    {b.status === "open" && <button className="btn-sm" onClick={() => sealBatch(b.id)}>封存批次</button>}
                  </div>
                </div>
                {b.status === "open" && (
                  <ul className="batch-records">
                    {b.recordIds.map((id) => {
                      const rec = state.records[id];
                      if (!rec) return null;
                      const v = effOf(rec);
                      return <li key={id}><span>{id}</span><span className={`pill ${verdictClass[v]}`}>{v}</span></li>;
                    })}
                  </ul>
                )}
                {b.snapshot && (
                  <table className="snapshot-table">
                    <thead>
                      <tr><th>记录</th><th>封存判定</th><th>粒子</th><th>压差</th><th>温湿度</th><th>设备</th></tr>
                    </thead>
                    <tbody>
                      {b.snapshot.map((s) => (
                        <tr key={s.recordId}>
                          <td>{s.recordId}</td>
                          <td><span className={`pill ${verdictClass[s.verdict]}`}>{s.verdict}</span></td>
                          <td>{s.fields.particle}</td>
                          <td>{s.fields.pressure}</td>
                          <td>{s.fields.thermal}</td>
                          <td>{s.fields.device}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ))}
          </div>
          <h3 className="draft-title">后到版本草稿（{state.drafts.length}）</h3>
          <div className="draft-list">
            {state.drafts.map((d) => (
              <div key={d.id} className="draft-card">
                <div className="record-head">
                  <div>
                    <h3>{d.id} → {d.checkpointId}</h3>
                    <p className="muted">{d.shift} · {d.author} · {d.origin === "offline" ? "离线" : "在线"} · {d.reason}</p>
                  </div>
                  <button className="btn-sm" onClick={() => promoteDraft(d.id)}>并入为冲突版本</button>
                </div>
                <p className="draft-fields">
                  {FIELD_ORDER.filter((k) => d.fields[k]).map((k) => `${FIELD_LABELS[k]}=${d.fields[k]!.value}`).join("；")}
                </p>
              </div>
            ))}
            {state.drafts.length === 0 && <p className="hint">暂无草稿：同一时间点只接受先到版本，后到的整套版本会保留在这里</p>}
          </div>
        </section>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p>操作留痕 · 按 opId 幂等</p>
            <h2>审计日志</h2>
          </div>
        </div>
        <div className="audit-list">
          {[...state.audit].slice(-15).reverse().map((a) => (
            <div key={a.opId} className="audit-item">
              <span className="audit-seq">#{a.seq}</span>
              <span className="pill v-audit">{AUDIT_LABELS[a.kind] ?? a.kind}</span>
              <span className="audit-detail">{a.detail}</span>
              <span className="muted">{a.at}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
