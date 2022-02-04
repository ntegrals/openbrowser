export interface UsageRecord {
  commands: number;
  navigations: number;
  screenshots: number;
  startTime: number;
  duration: number;
}

export interface UsageSnapshot {
  total: UsageRecord;
  session: UsageRecord;
}
