export interface ProviderHealthStatus {
  isHealthy: boolean;
  failureRate: number;
  sampleCount: number;
  lastFailureTime: number | null;
}

export class ProviderHealthMonitor {
  private windowMs = 30000;
  private maxFailureRateThreshold = 0.50; // Trip if > 50% fail
  private events: Array<{ success: boolean; timestamp: number }> = [];

  recordAttempt(success: boolean): void {
    this.events.push({ success, timestamp: Date.now() });
    this.prune();
  }

  private prune(): void {
    const cutoff = Date.now() - this.windowMs;
    this.events = this.events.filter((e) => e.timestamp >= cutoff);
  }

  getStatus(): ProviderHealthStatus {
    this.prune();
    const total = this.events.length;
    if (total < 5) {
      return { isHealthy: true, failureRate: 0, sampleCount: total, lastFailureTime: null };
    }

    const failures = this.events.filter((e) => !e.success).length;
    const failureRate = failures / total;
    const lastFailure = [...this.events].reverse().find((e) => !e.success)?.timestamp ?? null;

    return {
      isHealthy: failureRate < this.maxFailureRateThreshold,
      failureRate,
      sampleCount: total,
      lastFailureTime: lastFailure,
    };
  }
}