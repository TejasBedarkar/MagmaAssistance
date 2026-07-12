import { useState } from 'react';
import toast from 'react-hot-toast';
import { workOrders } from '@/api';
import { useAuth, ROLES } from '@/hooks/manufacturingAuth';
import { fmtDateTime } from '@/utils/format';
import { MfgButton } from '@/components/MfgPageLayout.jsx';
import { CheckCircle2, ClipboardCheck, ListChecks } from '@/icons/mfgIcons.js';

export default function WorkOrderComments({
  workOrder,
  comments = [],
  onUpdated,
  review = null,
}) {
  const { hasRole } = useAuth();
  const canViewCollab = hasRole(ROLES.PRODUCTION_HEAD, ROLES.SUPERVISOR);
  const canComment = canViewCollab;
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  const showReview = Boolean(review?.show);
  const reviewDone = Boolean(review?.reviewed);

  const submit = async () => {
    const value = text.trim();
    if (!value) {
      toast.error('Enter a comment');
      return;
    }
    setSaving(true);
    try {
      await workOrders.addComment(workOrder, value);
      setText('');
      toast.success('Comment added');
      await onUpdated?.();
    } finally {
      setSaving(false);
    }
  };

  if (!canViewCollab) {
    return null;
  }

  if (!showReview && !canComment && comments.length === 0) {
    return null;
  }

  return (
    <section className="card mfg-wo-collab">
      <div className="mfg-wo-collab__head">
        <div className="mfg-wo-collab__head-icon" aria-hidden>
          <ListChecks size={18} />
        </div>
        <div>
          <h3 className="mfg-wo-collab__title">Team coordination</h3>
          <p className="mfg-wo-collab__lead">Supervisor review and planning notes</p>
        </div>
      </div>

      {showReview ? (
        <div
          className={`mfg-wo-collab__review${reviewDone ? ' mfg-wo-collab__review--done' : ' mfg-wo-collab__review--pending'}`}
        >
          <div className="mfg-wo-collab__review-icon" aria-hidden>
            {reviewDone ? <CheckCircle2 size={18} /> : <ClipboardCheck size={18} />}
          </div>
          <div className="mfg-wo-collab__review-body">
            <p className="mfg-wo-collab__review-title">
              {reviewDone ? 'Supervisor reviewed' : 'Awaiting supervisor review'}
            </p>
            <p className="mfg-wo-collab__review-sub">
              {reviewDone ? (
                <>
                  <strong>{review.reviewedBy}</strong>
                  {review.reviewedOn ? ` · ${fmtDateTime(review.reviewedOn)}` : ''}
                </>
              ) : (
                'Supervisor should acknowledge this order before Head moves to Material Pending.'
              )}
            </p>
          </div>
          {review.canAcknowledge ? (
            <MfgButton
              size="sm"
              className="mfg-wo-collab__review-btn"
              onClick={review.onAcknowledge}
              disabled={review.acknowledging}
            >
              {review.acknowledging ? 'Saving…' : 'Acknowledge'}
            </MfgButton>
          ) : null}
        </div>
      ) : null}

      <div className="mfg-wo-collab__discussion">
        <p className="mfg-wo-collab__discussion-label">
          Discussion
          {comments.length > 0 ? (
            <span className="mfg-wo-collab__count">{comments.length}</span>
          ) : null}
        </p>

        {comments.length === 0 ? (
          <p className="mfg-wo-collab__empty">No notes yet — add context for the planning team.</p>
        ) : (
          <ul className="mfg-wo-comment-list">
            {comments.map((c) => (
              <li key={c.name} className="mfg-wo-comment-list__item">
                <div className="mfg-wo-comment-list__avatar" aria-hidden>
                  {(c.comment_by || '?').charAt(0).toUpperCase()}
                </div>
                <div className="mfg-wo-comment-list__body">
                  <p className="mfg-wo-comment-list__meta">
                    <strong>{c.comment_by}</strong>
                    <span>{fmtDateTime(c.creation)}</span>
                  </p>
                  <p className="mfg-wo-comment-list__text">{c.comment_text}</p>
                </div>
              </li>
            ))}
          </ul>
        )}

        {canComment ? (
          <div className="mfg-wo-comment-form">
            <textarea
              className="pm-input mfg-wo-comment-form__input"
              rows={2}
              placeholder="Add a planning note…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={saving}
            />
            <MfgButton
              size="sm"
              className="mfg-wo-comment-form__btn"
              onClick={submit}
              disabled={saving || !text.trim()}
            >
              {saving ? 'Posting…' : 'Post'}
            </MfgButton>
          </div>
        ) : null}
      </div>
    </section>
  );
}
