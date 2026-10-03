import { applyOp } from "./engine";
import { seedState } from "./seed";
import type { AppState, AuditEntry, Op } from "./types";

const STATE_KEY = "hxwl09.state.v1";
const JOURNAL_KEY = "hxwl09.journal.v1";

/** 批次日志：先写完整批次，再逐条落盘并记录进度，全部完成后才标记 committed */
export interface Journal {
  batchId: string;
  ops: Op[];
  applied: string[]; // 已落盘的 opId
  status: "pending" | "committed";
}

export class CrashError extends Error {}

export class Store {
  state: AppState;
  /** 本次启动是否发生过断点恢复（用于界面提示） */
  lastRecovery: string | null = null;
  private listeners = new Set<() => void>();
  private version = 0;
  private crashAfter: number | null = null;

  constructor() {
    const raw = localStorage.getItem(STATE_KEY);
    this.state = raw ? (JSON.parse(raw) as AppState) : seedState();
    if (!raw) this.persist();
    this.recover();
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): number => this.version;

  private emit(): void {
    this.version++;
    this.listeners.forEach((fn) => fn());
  }

  pendingJournal(): Journal | null {
    const raw = localStorage.getItem(JOURNAL_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as Journal;
    return j.status === "pending" ? j : null;
  }

  /** 测试钩子：让下一次 commit 在落盘 n 条操作后模拟写盘失败 */
  planCrash(afterOps: number): void {
    this.crashAfter = afterOps;
  }

  /**
   * 两段式提交：
   * 1. 完整批次（全部操作）先写入 journal（pending）；
   * 2. 逐条应用并落盘，每条记录进度；
   * 3. 全部完成后标记 committed。
   * 中途异常关闭时，journal 保持 pending，下次启动由 recover() 补齐。
   */
  commit(ops: Op[]): void {
    if (ops.length === 0) return;
    const journal: Journal = { batchId: `JB-${Date.now().toString(36)}`, ops, applied: [], status: "pending" };
    this.writeJournal(journal);
    let count = 0;
    for (const op of ops) {
      this.applyAndLog(op);
      journal.applied.push(op.opId);
      this.writeJournal(journal);
      count++;
      if (this.crashAfter !== null && count >= this.crashAfter) {
        this.crashAfter = null;
        this.emit();
        throw new CrashError(`写盘中断：批次 ${journal.batchId} 只落盘 ${count}/${ops.length} 条，待恢复`);
      }
    }
    journal.status = "committed";
    this.writeJournal(journal);
    this.emit();
  }

  /** 断点恢复：从完整批次中只补未完成的记录；审计按 opId 幂等，不会重复 */
  recover(): boolean {
    const journal = this.pendingJournal();
    if (!journal) return false;
    const remaining = journal.ops.filter((op) => !journal.applied.includes(op.opId));
    for (const op of remaining) {
      this.applyAndLog(op);
      journal.applied.push(op.opId);
      this.writeJournal(journal);
    }
    journal.status = "committed";
    this.writeJournal(journal);
    this.appendAudit({
      opId: `${journal.batchId}:recover`,
      kind: "recovered",
      detail: `批次 ${journal.batchId} 写盘中断后恢复：补入 ${remaining.length} 条未完成记录，审计不重复`,
    });
    this.lastRecovery = `已从完整批次 ${journal.batchId} 恢复 ${remaining.length} 条未完成记录，看板统计已按最新版本计算`;
    this.emit();
    return true;
  }

  reset(): void {
    localStorage.removeItem(STATE_KEY);
    localStorage.removeItem(JOURNAL_KEY);
    location.reload();
  }

  private applyAndLog(op: Op): void {
    applyOp(this.state, op, (kind, detail, suffix = "") => {
      this.appendAudit({ opId: op.opId + suffix, kind, detail });
    });
    this.persist();
  }

  private appendAudit(e: Omit<AuditEntry, "seq" | "at">): void {
    if (this.state.audit.some((a) => a.opId === e.opId)) return; // 幂等键：重复恢复不产生重复审计
    this.state.audit.push({ ...e, seq: ++this.state.seq, at: new Date().toLocaleTimeString("zh-CN", { hour12: false }) });
    this.persist();
  }

  private persist(): void {
    localStorage.setItem(STATE_KEY, JSON.stringify(this.state));
  }

  private writeJournal(j: Journal): void {
    localStorage.setItem(JOURNAL_KEY, JSON.stringify(j));
  }
}
