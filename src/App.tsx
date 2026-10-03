import { useState } from "react";
import "./styles.css";
import { Dashboard } from "./components/Dashboard";
import { Records } from "./components/Records";
import { Devices } from "./components/Devices";
import { Batches } from "./components/Batches";
import { Sync } from "./components/Sync";
import { ExportView } from "./components/ExportView";
import { useStore } from "./store";
import { pendingConflictCount, selectDashboard } from "./domain/selectors";

const TABS = [
  { id: "dashboard", label: "看板" },
  { id: "records", label: "巡检记录" },
  { id: "devices", label: "设备事件" },
  { id: "batches", label: "复核批次" },
  { id: "sync", label: "离线同步与审计" },
  { id: "export", label: "导出" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function App() {
  const [tab, setTab] = useState<TabId>("dashboard");
  const conflicts = useStore(pendingConflictCount);
  const stats = useStore(selectDashboard);

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">hxwl-09 · 半导体洁净室巡检 · 可追溯流程</p>
          <h1>离线合并 · 冲突双版本 · 设备失效重判 · 封存快照</h1>
          <p className="subtitle">
            巡检记录、设备事件、复核批次接成一条链：按房间/时间点/字段合并，同字段冲突保留两版进待复核；
            设备停机或校准使关联记录失效并重判，异常关闭不再按旧版本统计，已封存快照不改；
            两班撞点先到为准后到留草稿；写盘失败按完整批次只补未完成，审计不重复。
          </p>
        </div>
        <div className="stack-card">
          <span>当前状态</span>
          <strong>
            活动异常 {stats.danger} · 失效 {stats.void} · 待复核 {conflicts}
          </strong>
          <span className="dim small">草稿 {stats.drafts} · 失败会话 {stats.failedSessions} · 封存批次 {stats.openBatches ? `${stats.openBatches} 个进行中` : "—"}</span>
        </div>
      </section>

      <nav className="tabs main-tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? "tab active" : "tab"} onClick={() => setTab(t.id)}>
            {t.label}
            {t.id === "batches" && conflicts > 0 ? <i className="tab-dot">{conflicts}</i> : null}
            {t.id === "sync" && stats.failedSessions > 0 ? <i className="tab-dot danger">{stats.failedSessions}</i> : null}
          </button>
        ))}
      </nav>

      {tab === "dashboard" ? <Dashboard /> : null}
      {tab === "records" ? <Records /> : null}
      {tab === "devices" ? <Devices /> : null}
      {tab === "batches" ? <Batches /> : null}
      {tab === "sync" ? <Sync /> : null}
      {tab === "export" ? <ExportView /> : null}
    </main>
  );
}

export default App;
