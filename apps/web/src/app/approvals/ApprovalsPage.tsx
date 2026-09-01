import { useState } from 'react';
import { usePendingEdits, usePendingEditDiff, useApprovePendingEdit, useRejectPendingEdit } from '../../hooks/usePendingEdits';
import { ApprovalQueueList } from '../../components/approvals/ApprovalQueueList';
import { DiffView } from '../../components/approvals/DiffView';

export function ApprovalsPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [showReject, setShowReject] = useState(false);

  const queue = usePendingEdits('pending');
  const diff = usePendingEditDiff(selectedId);
  const approve = useApprovePendingEdit();
  const reject = useRejectPendingEdit();

  const selected = queue.data?.find((e) => e.id === selectedId) ?? null;

  const handleApprove = async () => {
    if (!selectedId) return;
    try {
      await approve.mutateAsync(selectedId);
      setSelectedId(null);
    } catch {
      // error shown below
    }
  };

  const handleReject = async () => {
    if (!selectedId) return;
    try {
      await reject.mutateAsync({ editId: selectedId, note: rejectNote.trim() || undefined });
      setSelectedId(null);
      setShowReject(false);
      setRejectNote('');
    } catch {
      // error shown below
    }
  };

  const mutationError = approve.error ?? reject.error;
  const errorMessage =
    mutationError instanceof Error ? mutationError.message : mutationError ? 'Something went wrong.' : null;

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold">Approvals</h1>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
        <aside className="max-h-[70vh] overflow-y-auto rounded border border-gray-200 md:col-span-2">
          <ApprovalQueueList
            edits={queue.data ?? []}
            selectedId={selectedId}
            onSelect={(id) => {
              setSelectedId(id);
              setShowReject(false);
            }}
            isLoading={queue.isLoading}
          />
        </aside>

        <section className="rounded border border-gray-200 p-4 md:col-span-3">
          {!selected || !selectedId ? (
            <p className="text-sm text-gray-500">Select a pending edit from the queue to review.</p>
          ) : diff.isFetching ? (
            <p className="text-sm text-gray-500">Loading diff…</p>
          ) : diff.isError || !diff.data ? (
            <p className="text-sm text-red-600">
              {diff.error instanceof Error ? diff.error.message : 'Could not load diff.'}
            </p>
          ) : (
            <>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">
                  {diff.data.editType === 'CREATE' ? 'New project' : 'Project edit'}
                </h2>
                <span className="text-xs text-gray-400">Requested {new Date(selected.created_at).toLocaleString()}</span>
              </div>

              <DiffView diff={diff.data} />

              {errorMessage && (
                <p className="mt-3 rounded bg-red-50 p-2 text-xs text-red-700">{errorMessage}</p>
              )}

              <div className="mt-4 flex items-center gap-2 border-t border-gray-100 pt-3">
                <button
                  type="button"
                  onClick={handleApprove}
                  disabled={approve.isPending}
                  className="rounded bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                >
                  {approve.isPending ? 'Approving…' : 'Approve'}
                </button>

                <button
                  type="button"
                  onClick={() => setShowReject((v) => !v)}
                  disabled={reject.isPending}
                  className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {reject.isPending ? 'Rejecting…' : 'Reject'}
                </button>
              </div>

              {showReject && (
                <div className="mt-3">
                  <label htmlFor="reject-note" className="mb-1 block text-xs text-gray-500">
                    Reason (optional)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      id="reject-note"
                      type="text"
                      value={rejectNote}
                      onChange={(e) => setRejectNote(e.target.value)}
                      className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                      placeholder="Why is this being rejected?"
                    />
                    <button
                      type="button"
                      onClick={handleReject}
                      className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
                    >
                      Confirm reject
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
