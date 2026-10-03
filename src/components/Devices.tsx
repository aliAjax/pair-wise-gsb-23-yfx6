import { useState } from "react";
import { dispatch, useStore } from "../store";
import { FIELD_LABELS } from "../domain/rules";
import type { State } from "../types";
import { Empty, fmtPoint } from "./ui";

const KIND_LABELS: Record<string, string> = {
  particleCounter: "粒子计数器",
  pressureGauge: "压差计",
  tempHumidityMeter: "温湿度仪",
};

export function Devices() {
  const devices = useStore((s: State) => s.devices);
  const events = useStore((s: State) => s.deviceEvents);
  const [deviceId, setDeviceId] = useState(devices[0]?.id ?? "");
  const [at, setAt] = useState("2026-10-03T13:00");
  const [note, setNote] = useState("");

  const submit = (type: "shutdown" | "calibration" | "restore") => {
    const defaultNote =
      type === "shutdown" ? "故障停机，读数中止" : type === "calibration" ? "送厂务校准，校准前读数不可信" : "修复完成恢复测量";
    dispatch({ type: "DEVICE_EVENT", deviceId, eventType: type, at, note: note || defaultNote });
    setNote("");
  };

  return (
    <div className="view-stack">
      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">设备事件</p>
            <h2>停机 / 校准 / 恢复登记</h2>
          </div>
        </div>
        <div className="field-grid form-grid">
          <label>
            <span>设备</span>
            <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}（{d.roomId} · {KIND_LABELS[d.kind]}）
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>事件时间</span>
            <input value={at} onChange={(e) => setAt(e.target.value)} />
          </label>
          <label className="span-2">
            <span>说明</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="留空使用默认说明" />
          </label>
        </div>
        <div className="btn-row">
          <button className="danger-btn" onClick={() => submit("shutdown")}>登记停机</button>
          <button className="warn-btn" onClick={() => submit("calibration")}>登记校准</button>
          <button onClick={() => submit("restore")}>登记恢复</button>
        </div>
        <ul className="rule-list">
          <li><b>停机</b>：该设备停机时间之后（含）采集的相关字段版本立即失效；恢复不复活旧读数，需复测补录。</li>
          <li><b>校准</b>：校准时间之前的相关字段版本失效；异常记录随之重判，若关键项无新值则整条失效并关闭异常。</li>
          <li><b>封存快照不改</b>：已封存批次内的旧判定原样保留，仅活动视图变化。</li>
        </ul>
      </section>

      <section className="panel">
        <p className="eyebrow">事件时间线</p>
        {events.length === 0 ? <Empty text="尚无设备事件" /> : (
          <table className="data-table">
            <thead>
              <tr><th>时间</th><th>设备</th><th>类型</th><th>影响字段</th><th>说明</th></tr>
            </thead>
            <tbody>
              {[...events].reverse().map((e) => (
                <tr key={e.id}>
                  <td>{fmtPoint(e.at)}</td>
                  <td>{devices.find((d) => d.id === e.deviceId)?.name ?? e.deviceId}<div className="dim small">{e.roomId}</div></td>
                  <td>
                    <span className={`badge ${e.type === "shutdown" ? "verdict-danger" : e.type === "calibration" ? "verdict-watch" : "verdict-ok"}`}>
                      {{ shutdown: "停机", calibration: "校准", restore: "恢复" }[e.type]}
                    </span>
                  </td>
                  <td>{e.fields.map((f) => FIELD_LABELS[f]).join("、")}</td>
                  <td>{e.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
