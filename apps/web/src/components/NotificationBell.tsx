import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotifications, useUnreadCount, useMarkAsRead, useMarkAllAsRead } from '../hooks/useNotifications';

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
    if (n.type === 'NEW_APPROVAL') {
      navigate('/approvals');
    } else {
      navigate('/grid');
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-md p-2 text-gray-600 hover:bg-gray-100"
        aria-label="Notifications"
        data-testid="notification-bell"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {count > 0 && (
          <span
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white"
            data-testid="notification-badge"
          >
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 z-50 mt-1 w-80 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg"
          data-testid="notification-panel"
        >
          <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
            <span className="text-sm font-semibold text-gray-700">Notifications</span>
            {count > 0 && (
              <button
                type="button"
                onClick={() => markAllAsRead.mutate()}
                className="text-xs text-blue-600 hover:underline"
                data-testid="mark-all-read"
              >
                Mark all as read
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-auto">
            {!notifications || notifications.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-gray-400" data-testid="no-notifications">
                No notifications
              </p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {notifications.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => handleItemClick(n)}
                      className={`w-full px-3 py-2.5 text-left hover:bg-gray-50 ${n.is_read ? '' : 'bg-blue-50'}`}
                      data-testid={`notification-item-${n.id}`}
                    >
                      <p className={`text-sm ${n.is_read ? 'text-gray-600' : 'font-medium text-gray-800'}`}>
                        {n.message}
                      </p>
                      <p className="mt-0.5 text-xs text-gray-400">{formatTime(n.created_at)}</p>
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
