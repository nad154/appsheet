import { useEffect, useRef, useState } from 'react';

export interface EntityOption {
  id: string;
  name: string;
}

interface EntityComboboxProps {
  // The currently selected entity id ('' = none).
  value: string;
  // Human-readable name for the currently selected id (may be null when the
  // referenced entity was deleted — the parent renders the orphan label).
  valueLabel: string | null;
  onSelect: (id: string) => void;
  // Server-backed type-ahead: returns the options matching q. Called with ''
  // on focus when empty to prefetch the full list.
  loadOptions: (q: string) => Promise<EntityOption[]>;
  // Optional "add new" fallback; when set, an `Add "<query>"` row appears when
  // no exact case-insensitive match exists. Must create the entity and return
  // its new id, which is then selected immediately (plan §3.4/3.5).
  onCreate?: (name: string) => Promise<string>;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
}

// Searchable entity combobox (customers + vendors). Type-ahead is debounced
// (~250ms); the list also opens with the full set on focus so plain clicking
// works without typing. "Add new" rows call the create endpoint and select the
// result in one step. Self-contained — it talks to the API through the
// loadOptions/onCreate callbacks it's given.
export function EntityCombobox({
  value,
  valueLabel,
  onSelect,
  loadOptions,
  onCreate,
  placeholder = 'Search…',
  ariaLabel,
  disabled,
}: EntityComboboxProps) {
  const [text, setText] = useState('');
  const [options, setOptions] = useState<EntityOption[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const searchTimer = useRef<number | undefined>(undefined);
  const rootRef = useRef<HTMLDivElement>(null);

  // Keep the displayed text in sync with the selected entity (e.g. after a
  // create-and-select round trip or when value resets externally). A null
  // label never clears the text though: right after a pick the parent doesn't
  // yet know the new id's name (it isn't in its static label map), so the
  // picked name must be left alone.
  useEffect(() => {
    if (value === '') {
      setText('');
    } else if (valueLabel) {
      setText(valueLabel);
    }
  }, [value, valueLabel]);

  // Close on outside click so the dropdown never lingers after picking.
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  useEffect(() => {
    setHighlight(-1);
  }, [text]);

  const trimmed = text.trim();

  const handleChange = (q: string) => {
    setText(q);
    setOpen(true);
    window.clearTimeout(searchTimer.current);
    if (!q.trim()) {
      setOptions([]);
      return;
    }
    searchTimer.current = window.setTimeout(async () => {
      setLoading(true);
      try {
        setOptions(await loadOptions(q.trim()));
      } catch {
        setOptions([]);
      } finally {
        setLoading(false);
      }
    }, 250);
  };

  // Focus on an empty field: prefetch the full list so type-ahead and a plain
  // click-browse both work from a known set.
  const handleFocus = () => {
    setOpen(true);
    if (text.trim()) return;
    let cancelled = false;
    setLoading(true);
    loadOptions('')
      .then((res) => {
        if (!cancelled) setOptions(res);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  };

  const exact = options.find((o) => o.name.toLowerCase() === trimmed.toLowerCase());
  const matches = options.filter((o) => o.name.toLowerCase().includes(trimmed.toLowerCase()));
  const canCreate = !!onCreate && trimmed.length > 0 && !exact;

  const pick = (option: EntityOption) => {
    setText(option.name);
    setOpen(false);
    onSelect(option.id);
  };

  const runCreate = async () => {
    if (!onCreate || creating) return;
    const name = trimmed;
    setCreating(true);
    try {
      const id = await onCreate(name);
      setText(name);
      setOpen(false);
      onSelect(id);
    } catch {
      // Keep the dropdown open so the user can correct / retry.
    } finally {
      setCreating(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const itemCount = matches.length + (canCreate ? 1 : 0);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => (itemCount === 0 ? -1 : Math.min(h + 1, itemCount - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = matches[highlight];
      if (item) pick(item);
      else if (canCreate) void runCreate();
      else if (exact) pick(exact);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const items: Array<{ kind: 'option'; option: EntityOption } | { kind: 'create' }> = [
    ...matches.map((o) => ({ kind: 'option' as const, option: o })),
    ...(canCreate ? [{ kind: 'create' as const }] : []),
  ];

  const optionCls = (isHighlighted: boolean) =>
    `w-full px-2 py-1.5 text-left text-sm ${isHighlighted ? 'bg-blue-50 text-blue-700' : 'text-gray-800 hover:bg-blue-50'}`;

  return (
    <div ref={rootRef} className="relative">
      <input
        type="text"
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={handleFocus}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={ariaLabel}
        className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-300"
      />
      {open && (
        <ul className="absolute z-30 mt-1 max-h-48 w-full overflow-auto rounded border border-gray-200 bg-white shadow-lg">
          {loading && matches.length === 0 && !canCreate && (
            <li className="px-2 py-1.5 text-sm text-gray-400">{creating ? 'Creating…' : 'Searching…'}</li>
          )}
          {items.map((item, i) =>
            item.kind === 'create' ? (
              <li key="__create__">
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void runCreate()}
                  disabled={creating}
                  className={`${optionCls(highlight === i)} disabled:opacity-50`}
                >
                  {creating ? 'Creating…' : `Add "${trimmed}"`}
                </button>
              </li>
            ) : (
              <li key={item.option.id}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(item.option)}
                  className={optionCls(highlight === i)}
                >
                  {item.option.name}
                </button>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}