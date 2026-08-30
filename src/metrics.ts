export interface CompletedCallRecord {
  callId: string;
  setupTimeMs: number;
  talkTimeMs: number;
  outcome: 'ANSWERED' | 'FAILED' | 'ABANDONED' | 'NO_ANSWER' | 'COMPLETED';
  timestamp: number;
}

export class MetricsCollector {
  private callHistory: CompletedCallRecord[] = [];
  private initialAnswerRate: number;

  constructor(private windowSizeMs = 300000, defaultAnswerRate = 0.40) {
    this.initialAnswerRate = defaultAnswerRate;
  }

  recordCall(record: CompletedCallRecord): void {
    this.callHistory.push(record);
    this.prune();
  }

  seedInitialMetrics(answerRate: number, avgTalkTimeSec = 90, avgSetupTimeSec = 5): void {
    this.initialAnswerRate = answerRate;
    const now = Date.now();
    const sampleSize = 10;
    const answeredCount = Math.round(sampleSize * answerRate);
    for (let i = 0; i < sampleSize; i++) {
      this.callHistory.push({
        callId: `seed-${i}`,
        setupTimeMs: avgSetupTimeSec * 1000,
        talkTimeMs: avgTalkTimeSec * 1000,
        outcome: i < answeredCount ? 'ANSWERED' : 'NO_ANSWER',
        timestamp: now,
      });
    }
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
        rollingAnswerRate: this.initialAnswerRate,
        avgTalkTimeSeconds: 90,
        avgSetupTimeSeconds: 5,
        abandonmentRate: 0.0,
        sampleSize: 0,
      };
    }

    const answered = this.callHistory.filter((c) => c.outcome === 'ANSWERED' || c.outcome === 'COMPLETED').length;
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