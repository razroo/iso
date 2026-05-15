import type { WorkflowLeaseRecord, WorkflowLeaseStatus } from './types.js';

export class WorkflowLeaseConflictError extends Error {
  readonly code = 'WORKFLOW_LEASE_CONFLICT';
  readonly leaseKey: string;
  readonly holder: string;
  readonly currentHolder: string;
  readonly expiresAt: string;

  constructor(input: { leaseKey: string; holder: string; currentHolder: string; expiresAt: string }) {
    super(
      `Lease "${input.leaseKey}" is held by "${input.currentHolder}" until ${input.expiresAt}; ` +
      `"${input.holder}" cannot take it yet`,
    );
    this.name = 'WorkflowLeaseConflictError';
    this.leaseKey = input.leaseKey;
    this.holder = input.holder;
    this.currentHolder = input.currentHolder;
    this.expiresAt = input.expiresAt;
  }
}

export function workflowLeaseStatus(
  lease: Pick<WorkflowLeaseRecord, 'expiresAt' | 'releasedAt'>,
  now: Date = new Date(),
): WorkflowLeaseStatus {
  if (lease.releasedAt) return 'released';
  if (Date.parse(lease.expiresAt) <= now.getTime()) return 'expired';
  return 'active';
}
