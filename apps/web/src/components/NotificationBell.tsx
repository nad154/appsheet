import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotifications, useUnreadCount, useMarkAsRead, useMarkAllAsRead } from '../hooks/useNotifications';
import { BellIcon } from './ui/icons';
import { EmptyState } from './ui/EmptyState';

function formatTime(createdAt: string): string {
  try {
    const d = new Date(createdAt);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString();
  } catch {
    return '';
  }
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const { count } = useUnreadCount();
  const { data: notifications } = useNotifications();
  const markAsRead = useMarkAsRead();
  const markAllAsRead = useMarkAllAsRead();
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleItemClick = (n: { id: string; type: string; project_id: string | null; pending_edit_id: string | null; is_read: boolean }) => {
    setOpen(false);
    if (!n.is_read) markAsRead.mutate(n.id);
    // The legacy NEW_APPROVAL type is no longer produced (STAFF writes apply
    // immediately); any notification click lands on the grid.
    navigate('/grid');
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-md p-2 text-ink-muted transition-colors hover:bg-canvas hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        aria-label="Notifications"
        data-testid="notification-bell"
      >
        <BellIcon size={20} />
        {count > 0 && (
          <span
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white"
            data-testid="notification-badge"
          >
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-lg border border-border bg-surface shadow-overlay"
          data-testid="notification-panel"
        >
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-sm font-semibold text-ink">Notifications</span>
            {count > 0 && (
              <button
                type="button"
                onClick={() => markAllAsRead.mutate()}
                className="text-xs text-accent hover:underline"
                data-testid="mark-all-read"
              >
                Mark all as read
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-auto">
            {!notifications || notifications.length === 0 ? (
              <div data-testid="no-notifications">
                <EmptyState title="No notifications" className="py-6" />
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {notifications.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => handleItemClick(n)}
                      className={`w-full border-l-2 px-3 py-2.5 text-left transition-colors hover:bg-canvas ${
                        n.is_read ? 'border-l-transparent' : 'border-l-accent bg-accent-soft'
                      }`}
                      data-testid={`notification-item-${n.id}`}
                    >
                      <p className={`text-sm ${n.is_read ? 'text-ink-muted' : 'font-medium text-ink'}`}>
                        {n.message}
                      </p>
                      <p className="mt-0.5 text-xs text-ink-muted">{formatTime(n.created_at)}</p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
