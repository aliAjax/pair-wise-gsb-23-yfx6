import { useStore } from "../store";
import { selectConsistencyHash, selectDashboard, selectSealedSummary } from "../domain/selectors";

function Metric({ label, value, tone, hint }: { label: string; value: number; tone: string; hint?: string }) {
  return (
    <article className={`metric-card metric-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {hint ? <small>{hint}</small> : null}
    </article>
  );
}

export function Dashboard() {
  const stats = useStore(selectDashboard);
  const sealed = useStore(selectSealedSummary);
  const hash = useStore(selectConsistencyHash);
  const closedCount = useStore((s) => s.audit.filter((a) => a.type === "anomaly.closed").length);

  return (
    <div className="view-stack">
      <section className="metrics-grid metrics-5">
        <Metric label="活动异常（当前有效判定）" value={stats.danger} tone="danger" hint="旧值被覆盖不再统计" />
        <Metric label="异常已关闭（旧版本不再统计）" value={closedCount} tone="muted" hint="审计 anomaly.closed" />
        <Metric label="失效待复测" value={stats.void} tone="warn" hint="设备停机/校准关联记录" />
        <Metric label="关注" value={stats.watch} tone="watch" />
        <Metric label="正常" value={stats.normal} tone="ok" />
      </section>

      <section className="metrics-grid metrics-5">
        <Metric label="字段冲突待复核" value={stats.pendingReview} tone="warn" hint="两版并存，暂按先到" />
        <Metric label="后到草稿（两班撞点）" value={stats.drafts} tone="watch" hint="先到版本已接受" />
        <Metric label="未完成写盘会话" value={stats.failedSessions} tone="danger" hint="完整批次待恢复" />
        <Metric label="进行中复核批次" value={stats.openBatches} tone="ok" />
        <Metric label="逻辑记录总数" value={stats.total} tone="muted" hint="房间+时间点" />
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">统一有效判定</p>
            <h2>看板 / 记录列表 / 导出 一致性</h2>
          </div>
          <span className="hash-chip" title="三处视图消费同一份投影 selectEffectiveRows">
            判定指纹 <code>{hash}</code>
          </span>
        </div>
        <ul className="rule-list">
          <li>离线数据按<b>房间 + 时间点 + 字段</b>合并；同字段不同值保留两版进入待复核，临时判定采用先到版本。</li>
          <li>设备停机 / 校准后，相关测量版本失效：粒子或压差等关键项无新值时整条记录判为<b>失效</b>，异常自动关闭，不再按旧版本计数。</li>
          <li>已复核批次封存为只读快照；后续失效、复测、重判都<b>不改写封存数字</b>（差异可对照活动视图与快照）。</li>
          <li>两班同一时间点只接受先到版本，后到整条保留草稿，可由复核人工采纳。</li>
          <li>写盘失败后从完整批次恢复，只补未完成记录；审计按幂等键去重不重复。</li>
        </ul>
      </section>

      {stats.activeAnomalies.length > 0 && (
        <section className="panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">待处理</p>
              <h2>当前活动异常</h2>
            </div>
          </div>
          <div className="alert-list">
            {stats.activeAnomalies.map((a) => (
              <div className="alert-row" key={a.roomId + a.point}>
                <strong>{a.roomId}</strong>
                <span className="dim">{a.point.replace("T", " ")}</span>
                <span>{a.reasons.join("；")}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="panel">
        <p className="eyebrow">封存批次（历史快照）</p>
        {sealed.length === 0 ? (
          <p className="empty">暂无封存批次</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr><th>批次</th><th>封存人</th><th>正常</th><th>关注</th><th>异常</th><th>失效</th></tr>
            </thead>
            <tbody>
              {sealed.map((b) => (
                <tr key={b.id}>
                  <td>{b.title} <span className="dim">{b.id}</span></td>
                  <td>{b.sealedBy}</td>
                  <td>{b.summary.normal}</td>
                  <td>{b.summary.watch}</td>
                  <td><b className="text-danger">{b.summary.danger}</b></td>
                  <td>{b.summary.void}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
