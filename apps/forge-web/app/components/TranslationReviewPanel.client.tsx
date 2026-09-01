import { formatStatusLabel } from '@casioplus/i18n/display-labels';
import { formatDateTime } from '@casioplus/i18n/formatters';
import { m } from '@casioplus/i18n/messages';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  ExternalLink,
  FileCheck2,
  GitPullRequest,
  Pencil,
  RefreshCw,
  Send,
  ShieldCheck,
  X,
} from 'lucide-react';

type ChangeSet = {
  id: string;
  processRunId: string;
  repositoryFullName: string;
  baseRef: string;
  baseCommitSha: string;
  sourceLocale: 'en';
  targetLocale: 'fa';
  status: string;
  requestedByActorId: string;
  expiresAt: string;
  createdAt: string;
  itemCount?: number;
  proposedCount?: number;
  acceptedCount?: number;
  rejectedCount?: number;
  approvalId?: string | null;
  outboxId?: string | null;
  repositoryBranchRef?: string | null;
  pullRequestNumber?: number | null;
  pullRequestUrl?: string | null;
  pullRequestHeadSha?: string | null;
  failureCode?: string | null;
};

type ChangeSetItem = {
  id: string;
  messageKey: string;
  sourceText: string;
  currentTargetText: string | null;
  proposedText: string;
  reviewedText: string | null;
  sourceHash: string;
  proposalHash: string;
  placeholderSignature: string[];
  status: string;
  reviewReason: string | null;
};

type Props = {
  apiBase: string;
  csrfToken: string;
  actorId: string;
  role: string;
};

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH';
  body?: Record<string, unknown>;
};

async function requestJson<T>(
  apiBase: string,
  path: string,
  csrfToken: string,
  options: RequestOptions = {},
): Promise<T> {
  const method = options.method ?? 'GET';
  const response = await fetch(`${apiBase}${path}`, {
    method,
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      ...(method === 'GET' ? {} : { 'x-casioplus-csrf': csrfToken }),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const body = (await response.json().catch(() => ({}))) as { error?: string } & T;
  if (!response.ok) throw new Error(body.error ?? `request_failed_${response.status}`);
  return body;
}

export default function TranslationReviewPanel({ apiBase, csrfToken, actorId, role }: Props) {
  const [changeSets, setChangeSets] = useState<ChangeSet[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [selected, setSelected] = useState<ChangeSet | null>(null);
  const [items, setItems] = useState<ChangeSetItem[]>([]);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const canAuthor = ['owner', 'admin', 'editor'].includes(role);
  const canReviewRole = ['owner', 'admin', 'reviewer'].includes(role);
  const canQueueRepositorySync = ['owner', 'admin', 'editor', 'reviewer'].includes(role);
  const canReview = Boolean(
    canReviewRole &&
    selected &&
    selected.status === 'ready_for_review' &&
    selected.requestedByActorId !== actorId,
  );

  const loadDetail = useCallback(
    async (changeSetId: string) => {
      const body = await requestJson<{ changeSet: ChangeSet; items: ChangeSetItem[] }>(
        apiBase,
        `/api/v1/translation-change-sets/${changeSetId}`,
        csrfToken,
      );
      setSelected(body.changeSet);
      setItems(body.items);
      setEdits(
        Object.fromEntries(
          body.items.map((item) => [item.id, item.reviewedText ?? item.proposedText]),
        ),
      );
    },
    [apiBase, csrfToken],
  );

  const loadChangeSets = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const body = await requestJson<{ changeSets: ChangeSet[] }>(
        apiBase,
        '/api/v1/translation-change-sets',
        csrfToken,
      );
      setChangeSets(body.changeSets);
      const nextId =
        (selectedId && body.changeSets.some((entry) => entry.id === selectedId)
          ? selectedId
          : body.changeSets[0]?.id) ?? '';
      setSelectedId(nextId);
      if (nextId) await loadDetail(nextId);
      else {
        setSelected(null);
        setItems([]);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'translation_change_sets_load_failed');
    } finally {
      setLoading(false);
    }
  }, [apiBase, csrfToken, loadDetail, selectedId]);

  useEffect(() => {
    void loadChangeSets();
  }, [loadChangeSets]);

  const selectChangeSet = useCallback(
    async (changeSetId: string) => {
      setSelectedId(changeSetId);
      setError('');
      try {
        await loadDetail(changeSetId);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'translation_change_set_load_failed');
      }
    },
    [loadDetail],
  );

  const mutate = useCallback(
    async (operation: () => Promise<void>, success: string) => {
      setPending(true);
      setError('');
      setNotice('');
      try {
        await operation();
        setNotice(success);
        await loadChangeSets();
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : 'translation_change_set_mutation_failed',
        );
      } finally {
        setPending(false);
      }
    },
    [loadChangeSets],
  );

  const submitForReview = useCallback(() => {
    if (!selected) return;
    void mutate(async () => {
      await requestJson(
        apiBase,
        `/api/v1/translation-change-sets/${selected.id}/submit`,
        csrfToken,
        { method: 'POST', body: {} },
      );
    }, m.forge_translation_review_submitted());
  }, [apiBase, csrfToken, mutate, selected]);

  const reviewItem = useCallback(
    (item: ChangeSetItem, decision: 'accepted' | 'edited' | 'rejected') => {
      if (!selected) return;
      const reason = reasons[item.id]?.trim();
      if (!reason) {
        setError('translation_review_reason_required');
        return;
      }
      void mutate(async () => {
        await requestJson(
          apiBase,
          `/api/v1/translation-change-sets/${selected.id}/items/${item.id}/review`,
          csrfToken,
          {
            method: 'PATCH',
            body: {
              decision,
              reason,
              ...(decision === 'edited' ? { reviewedText: edits[item.id] } : {}),
            },
          },
        );
      }, m.forge_translation_review_item_saved());
    },
    [apiBase, csrfToken, edits, mutate, reasons, selected],
  );

  const completeReview = useCallback(() => {
    if (!selected) return;
    void mutate(async () => {
      await requestJson(
        apiBase,
        `/api/v1/translation-change-sets/${selected.id}/complete-review`,
        csrfToken,
        { method: 'POST', body: {} },
      );
    }, m.forge_translation_review_completed());
  }, [apiBase, csrfToken, mutate, selected]);

  const requestRepositoryApproval = useCallback(() => {
    if (!selected) return;
    void mutate(async () => {
      await requestJson(
        apiBase,
        `/api/v1/translation-change-sets/${selected.id}/request-approval`,
        csrfToken,
        { method: 'POST', body: { expiresInSeconds: 86_400 } },
      );
    }, m.forge_translation_repository_approval_requested());
  }, [apiBase, csrfToken, mutate, selected]);

  const queueRepositorySync = useCallback(() => {
    if (!selected) return;
    void mutate(async () => {
      await requestJson(
        apiBase,
        `/api/v1/translation-change-sets/${selected.id}/queue-sync`,
        csrfToken,
        { method: 'POST', body: {} },
      );
    }, m.forge_translation_repository_queued());
  }, [apiBase, csrfToken, mutate, selected]);

  const pendingItems = useMemo(
    () => items.filter((item) => item.status === 'proposed').length,
    [items],
  );
  const acceptedItems = useMemo(
    () => items.filter((item) => ['accepted', 'edited'].includes(item.status)).length,
    [items],
  );

  return (
    <section className="translation-review-panel" aria-labelledby="translation-review-title">
      <header className="translation-review-header">
        <div>
          <span className="section-index">{m.forge_translation_review_index()}</span>
          <h2 id="translation-review-title">{m.forge_translation_review_title()}</h2>
          <p>{m.forge_translation_review_description()}</p>
        </div>
        <button
          type="button"
          className="icon-control"
          onClick={() => void loadChangeSets()}
          disabled={loading || pending}
          aria-label={m.forge_translation_review_refresh()}
        >
          <RefreshCw size={16} />
        </button>
      </header>

      <div className="translation-review-status" aria-live="polite">
        {notice && <span className="runtime-ready">{notice}</span>}
        {error && <code dir="ltr">{error}</code>}
      </div>

      {loading ? (
        <div className="inspector-empty">{m.forge_translation_review_loading()}</div>
      ) : changeSets.length === 0 ? (
        <div className="inspector-empty">{m.forge_translation_review_empty()}</div>
      ) : (
        <div className="translation-review-layout">
          <nav
            className="translation-change-set-list"
            aria-label={m.forge_translation_review_title()}
          >
            {changeSets.map((changeSet) => (
              <button
                key={changeSet.id}
                type="button"
                className={changeSet.id === selectedId ? 'active' : ''}
                aria-current={changeSet.id === selectedId ? 'true' : undefined}
                onClick={() => void selectChangeSet(changeSet.id)}
              >
                <span>
                  <bdi dir="ltr">{changeSet.id.slice(0, 8)}</bdi>
                  <strong>{formatStatusLabel(changeSet.status)}</strong>
                </span>
                <small>
                  {m.forge_translation_review_items({ count: changeSet.itemCount ?? 0 })}
                </small>
              </button>
            ))}
          </nav>

          {selected && (
            <div className="translation-review-detail">
              <div className="translation-change-set-meta">
                <div>
                  <span>{m.forge_translation_review_repository()}</span>
                  <code dir="ltr">{selected.repositoryFullName}</code>
                </div>
                <div>
                  <span>{m.forge_translation_review_base()}</span>
                  <code dir="ltr">{selected.baseCommitSha.slice(0, 12)}</code>
                </div>
                <div>
                  <span>{m.forge_translation_review_expires()}</span>
                  <strong>{formatDateTime(selected.expiresAt)}</strong>
                </div>
                <div>
                  <span>{formatStatusLabel(selected.status)}</span>
                  <code dir="ltr">{selected.processRunId.slice(0, 12)}</code>
                </div>
              </div>

              {selected.status === 'draft' && canAuthor && (
                <button
                  className="primary-action"
                  type="button"
                  disabled={pending}
                  onClick={submitForReview}
                >
                  <Send size={14} /> {m.forge_translation_review_submit()}
                </button>
              )}

              {selected.status === 'ready_for_review' && !canReview && (
                <div className="translation-review-boundary">
                  {selected.requestedByActorId === actorId
                    ? m.forge_translation_review_different_reviewer()
                    : m.forge_translation_review_read_only()}
                </div>
              )}

              <div className="translation-item-list">
                {items.map((item) => (
                  <article key={item.id} className="translation-item-card">
                    <header>
                      <code dir="ltr">{item.messageKey}</code>
                      <span>{formatStatusLabel(item.status)}</span>
                    </header>
                    <div className="translation-copy-grid">
                      <div>
                        <span>{m.forge_translation_review_source()}</span>
                        <p dir="ltr">{item.sourceText}</p>
                      </div>
                      <div>
                        <span>{m.forge_translation_review_current()}</span>
                        <p dir="rtl">
                          {item.currentTargetText ?? m.forge_translation_review_no_current()}
                        </p>
                      </div>
                      <div>
                        <span>{m.forge_translation_review_proposal()}</span>
                        <p dir="rtl">{item.proposedText}</p>
                      </div>
                      {item.reviewedText && (
                        <div>
                          <span>{m.forge_translation_review_final()}</span>
                          <p dir="rtl">{item.reviewedText}</p>
                        </div>
                      )}
                    </div>
                    {canReview && item.status === 'proposed' && (
                      <div className="translation-review-form">
                        <label>
                          <span>{m.forge_translation_review_edit_label()}</span>
                          <textarea
                            dir="rtl"
                            value={edits[item.id] ?? item.proposedText}
                            onChange={(event) =>
                              setEdits((current) => ({ ...current, [item.id]: event.target.value }))
                            }
                          />
                        </label>
                        <label>
                          <span>{m.forge_translation_review_reason()}</span>
                          <input
                            dir="auto"
                            value={reasons[item.id] ?? ''}
                            placeholder={m.forge_translation_review_reason_placeholder()}
                            onChange={(event) =>
                              setReasons((current) => ({
                                ...current,
                                [item.id]: event.target.value,
                              }))
                            }
                          />
                        </label>
                        <div className="translation-review-actions">
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => reviewItem(item, 'accepted')}
                          >
                            <Check size={13} /> {m.forge_translation_review_accept()}
                          </button>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => reviewItem(item, 'edited')}
                          >
                            <Pencil size={13} /> {m.forge_translation_review_accept_edit()}
                          </button>
                          <button
                            type="button"
                            className="danger-text-action"
                            disabled={pending}
                            onClick={() => reviewItem(item, 'rejected')}
                          >
                            <X size={13} /> {m.forge_translation_review_reject()}
                          </button>
                        </div>
                      </div>
                    )}
                    {item.reviewReason && (
                      <small className="translation-review-reason" dir="auto">
                        {item.reviewReason}
                      </small>
                    )}
                  </article>
                ))}
              </div>

              {canReviewRole && canReview && pendingItems === 0 && acceptedItems > 0 && (
                <button
                  type="button"
                  className="primary-action"
                  disabled={pending}
                  onClick={completeReview}
                >
                  <FileCheck2 size={14} /> {m.forge_translation_review_complete()}
                </button>
              )}

              {selected.status === 'ready_for_approval' && canReviewRole && (
                <button
                  type="button"
                  className="primary-action"
                  disabled={pending}
                  onClick={requestRepositoryApproval}
                >
                  <ShieldCheck size={14} />
                  {m.forge_translation_repository_request_approval()}
                </button>
              )}

              {selected.status === 'pending_approval' && (
                <div className="translation-review-boundary">
                  {m.forge_translation_repository_awaiting_approval()}
                </div>
              )}

              {selected.status === 'approved' && canQueueRepositorySync && (
                <button
                  type="button"
                  className="primary-action"
                  disabled={pending}
                  onClick={queueRepositorySync}
                >
                  <GitPullRequest size={14} /> {m.forge_translation_repository_queue()}
                </button>
              )}

              {selected.status === 'sync_queued' && (
                <div className="translation-review-boundary">
                  {m.forge_translation_repository_queued()}
                </div>
              )}

              {selected.pullRequestUrl && selected.pullRequestNumber && (
                <div className="translation-repository-result">
                  <a href={selected.pullRequestUrl} target="_blank" rel="noreferrer">
                    <ExternalLink size={14} />
                    {m.forge_translation_repository_open_pr({
                      number: selected.pullRequestNumber,
                    })}
                  </a>
                  <p>
                    {selected.status === 'merged'
                      ? m.forge_translation_repository_merged()
                      : m.forge_translation_repository_pr_ready()}
                  </p>
                </div>
              )}

              {selected.status === 'failed' && (
                <div className="translation-review-boundary">
                  <p>{m.forge_translation_repository_failed()}</p>
                  {selected.failureCode && (
                    <code dir="ltr">
                      {m.forge_translation_repository_failure_code()}: {selected.failureCode}
                    </code>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
