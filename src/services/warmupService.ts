import { randomUUID } from 'node:crypto';
import type { WarmupJob, WarmupMode } from '../types.js';

export class WarmupService {
  private jobs = new Map<string, WarmupJob>();
  private timers = new Map<string, NodeJS.Timeout>();

  startWarmup(input: {
    userId: number;
    accountIds: number[];
    mode: WarmupMode;
    durationHours: number;
    delayMin: number;
    delayMax: number;
  }): WarmupJob {
    const now = new Date();
    const job: WarmupJob = {
      id: randomUUID(),
      userId: input.userId,
      accountIds: input.accountIds,
      mode: input.mode,
      durationHours: input.durationHours,
      delayMin: input.delayMin,
      delayMax: input.delayMax,
      startedAt: now.toISOString(),
      endsAt: new Date(now.getTime() + input.durationHours * 60 * 60 * 1000).toISOString(),
      status: 'running',
    };

    this.jobs.set(job.id, job);

    const timer = setTimeout(() => {
      this.stopWarmup(job.id, 'completed');
    }, input.durationHours * 60 * 60 * 1000);

    this.timers.set(job.id, timer);
    void this.runLoop(job);

    return job;
  }

  stopWarmup(jobId: string, status: WarmupJob['status'] = 'stopped'): boolean {
    const job = this.jobs.get(jobId);
    if (!job) {
      return false;
    }

    job.status = status;
    this.jobs.delete(jobId);

    const timer = this.timers.get(jobId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(jobId);
    }

    return true;
  }

  getActiveJobs(): WarmupJob[] {
    return Array.from(this.jobs.values());
  }

  private async runLoop(job: WarmupJob): Promise<void> {
    while (this.jobs.has(job.id) && this.jobs.get(job.id)?.status === 'running') {
      const accountIds = job.accountIds;
      if (accountIds.length < 2) {
        break;
      }

      const sender = accountIds[Math.floor(Math.random() * accountIds.length)];
      const recipients = accountIds.filter((item) => item !== sender);
      const receiver = recipients[Math.floor(Math.random() * recipients.length)] ?? sender;
      const content = this.buildContent();

      console.log(`warmup ${job.id}: account ${sender} -> ${receiver} :: ${content}`);

      await new Promise((resolve) => {
        setTimeout(resolve, this.randomDelay(job.delayMin, job.delayMax));
      });
    }

    this.stopWarmup(job.id, 'completed');
  }

  private buildContent(): string {
    const templates = [
      'Привет, проверяю активность чата',
      'Подтверждаю связь, всё в порядке',
      'Отправляю короткое сообщение для прогрева',
      'Проверка диалога, продолжаю переписку',
      '🙂 Всё нормально, общение идёт стабильно',
    ];

    return templates[Math.floor(Math.random() * templates.length)] ?? 'Привет';
  }

  private randomDelay(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1) + min) * 1000;
  }
}

export const warmupService = new WarmupService();
