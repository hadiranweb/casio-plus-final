import { m } from './paraglide/messages.js';

const statusLabels: Record<string, () => string> = {
  accepted: m.shared_status_accepted,
  active: m.shared_status_active,
  approved: m.shared_status_approved,
  archived: m.shared_status_archived,
  available: m.shared_status_available,
  blocked: m.shared_status_blocked,
  cancelled: m.shared_status_cancelled,
  completed: m.shared_status_completed,
  dead_letter: m.shared_status_dead_letter,
  deleted: m.shared_status_deleted,
  disabled: m.shared_status_disabled,
  dispatched: m.shared_status_dispatched,
  draft: m.shared_status_draft,
  expired: m.shared_status_expired,
  failed: m.shared_status_failed,
  in_progress: m.shared_status_in_progress,
  invited: m.shared_status_invited,
  mismatch: m.shared_status_mismatch,
  open: m.shared_status_open,
  pending: m.shared_status_pending,
  pending_review: m.shared_status_pending_review,
  planning: m.shared_status_planning,
  published: m.shared_status_published,
  queued: m.shared_status_queued,
  rejected: m.shared_status_rejected,
  retired: m.shared_status_retired,
  retiring: m.shared_status_retiring,
  retry: m.shared_status_retry,
  revoked: m.shared_status_revoked,
  running: m.shared_status_running,
  succeeded: m.shared_status_succeeded,
  superseded: m.shared_status_superseded,
  validated: m.shared_status_validated,
  verified: m.shared_status_verified,
};

const roleLabels: Record<string, () => string> = {
  owner: m.shared_role_owner,
  admin: m.shared_role_admin,
  editor: m.shared_role_editor,
  reviewer: m.shared_role_reviewer,
  viewer: m.shared_role_viewer,
  consumer: m.shared_role_consumer,
};

export function formatStatusLabel(status: string) {
  return statusLabels[status]?.() ?? status;
}

export function formatRoleLabel(role: string) {
  return roleLabels[role]?.() ?? role;
}
