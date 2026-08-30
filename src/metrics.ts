export interface CompletedCallRecord {
  callId: string;
  setupTimeMs: number;
  talkTimeMs: number;
  outcome: 'ANSWERED' | 'FAILED' | 'ABANDONED' | 'NO_ANSWER';
  timestamp: number;
}

export class MetricsCollector {
  private callHistory: CompletedCallRecord[] = [];

  constructor(private windowSizeMs = 300000) {} // 5-minute sliding window

  recordCall(record: CompletedCallRecord): void {
    this.callHistory.push(record);
    this.prune();
  }

  private prune(): void {
    const cutoff = Date.now() - this.windowSizeMs;
    this.callHistory = this.callHistory.filter((c) => c.timestamp >= cutoff);
  }

  getMetrics(): {
    rollingAnswerRate: number;
    avgTalkTimeSeconds: number;
    avgSetupTimeSeconds: number;
    abandonmentRate: number;
    sampleSize: number;
  } {
    this.prune();
    const total = this.callHistory.length;
    if (total === 0) {
      return {
        rollingAnswerRate: 0.3, // Cold-start default: 30%
        avgTalkTimeSeconds: 90,  // Cold-start default: 90s
        avgSetupTimeSeconds: 5,  // Cold-start default: 5s
        abandonmentRate: 0.0,
        sampleSize: 0,
      };
    }

    const answered = this.callHistory.filter((c) => c.outcome === 'ANSWERED' || c.outcome === 'ABANDONED').length;
    const abandoned = this.callHistory.filter((c) => c.outcome === 'ABANDONED').length;

    const totalSetupMs = this.callHistory.reduce((acc, c) => acc + c.setupTimeMs, 0);
    const totalTalkMs = this.callHistory.reduce((acc, c) => acc + c.talkTimeMs, 0);

    return {
      rollingAnswerRate: Math.max(0.05, answered / total),
      avgTalkTimeSeconds: Math.max(10, Math.round(totalTalkMs / total / 1000)),
      avgSetupTimeSeconds: Math.max(1, Math.round(totalSetupMs / total / 1000)),
      abandonmentRate: answered > 0 ? abandoned / answered : 0.0,
      sampleSize: total,
    };
  }
}