interface ActiveEntry {
  jobId: string;
  cancel: () => void;
}

/**
 * In-memory registry of the execution currently running for each identity, so
 * the `cancel` command can find and stop it. Valid only because the queue
 * processor runs in the same process as the rest of the app (generalizes
 * activeJobs.js).
 */
export class ActiveExecutionRegistry {
  private readonly active = new Map<string, ActiveEntry>();

  register(identityId: string, jobId: string, cancel: () => void): void {
    this.active.set(identityId, { jobId, cancel });
  }

  get(identityId: string): ActiveEntry | undefined {
    return this.active.get(identityId);
  }

  /** Only clears the entry if it still belongs to the job that registered it. */
  clear(identityId: string, jobId: string): void {
    const entry = this.active.get(identityId);
    if (entry && entry.jobId === jobId) {
      this.active.delete(identityId);
    }
  }
}
