import { useEffect, useRef, useState } from 'react';
import { IMPORT_FIELDS, IMPORT_FIELD_SECTIONS } from '@tracker/shared';
import type { ImportField } from '@tracker/shared';
import { cn } from '../ui/cn';
import { ChevronDownIcon } from '../ui/icons';

const TYPE_HINT: Record<ImportField['type'], string> = {
  text: 'Text',
  number: 'Whole number',
  date: 'Date',
  enum: '',
  lookup: 'Existing name — created during import if new',
};

export function fieldTypeInfo(field: ImportField): string {
  if (field.type === 'enum') {
    return `One of: ${(field.enumValues ?? []).join(' / ')}`;
  }
  return TYPE_HINT[field.type];
}

interface FieldSelectProps {
  /** Selected import field key, or null = ignore this column. */
  value: string | null;
  /** fieldKey -> CSV header already using it, so a field can be chosen once. */
  usedBy: Map<string, string>;
  /** The CSV header owning this dropdown (so it isn't disabled against itself). */
  header: string;
  onChange: (fieldKey: string | null) => void;
  ariaLabel: string;
}

/**
 * Grouped "pick a platform field" listbox. A native <select> can't show the
 * per-option descriptions the plan asks for, so this renders label + subtitle
 * rows, grouped by registry section. Fields already used by another CSV
 * column are disabled with a tooltip naming that column.
 */
export function FieldSelect({ value, usedBy, header, onChange, ariaLabel }: FieldSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Close only this dropdown — the Modal's window-level Escape handler
        // would otherwise also close the whole wizard and lose the mapping.
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const selected = value ? IMPORT_FIELDS.find((f) => f.key === value) : undefined;

  const pick = (key: string | null) => {
    onChange(key);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative min-w-[16rem]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5 text-left text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
      >
        <span className={cn('truncate', !selected && 'text-ink-muted')}>
          {selected ? selected.label : 'Ignore this column'}
        </span>
        <ChevronDownIcon size={14} className="shrink-0 text-ink-muted" />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={ariaLabel}
          className="absolute left-0 top-full z-40 mt-1 max-h-72 w-full min-w-[22rem] overflow-auto rounded-md border border-border bg-surface py-1 shadow-overlay"
        >
          <button
            type="button"
            role="option"
            aria-selected={value === null}
            onClick={() => pick(null)}
            className={cn(
              'flex w-full flex-col gap-0.5 px-3 py-1.5 text-left text-sm hover:bg-canvas',
              value === null && 'bg-canvas font-medium',
            )}
          >
            <span>Ignore this column</span>
            <span className="text-xs text-ink-muted">This CSV column will not be imported.</span>
          </button>

          {IMPORT_FIELD_SECTIONS.map((section) => {
            const fields = IMPORT_FIELDS.filter((f) => f.section === section);
            if (fields.length === 0) return null;
            return (
              <div key={section} className="mt-1 border-t border-border pt-1">
                <p className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                  {section}
                </p>
                {fields.map((f) => {
                  const using = usedBy.get(f.key);
                  const disabled = using !== undefined && using !== header;
                  return (
                    <button
                      key={f.key}
                      type="button"
                      role="option"
                      aria-selected={value === f.key}
                      disabled={disabled}
                      title={disabled ? `Already used by "${using}"` : undefined}
                      onClick={() => pick(f.key)}
                      className={cn(
                        'flex w-full flex-col gap-0.5 px-3 py-1.5 text-left text-sm',
                        disabled
                          ? 'cursor-not-allowed opacity-40'
                          : 'hover:bg-canvas',
                        !disabled && value === f.key && 'bg-canvas font-medium',
                      )}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span>{f.label}</span>
                        {f.required && <span className="text-xs text-danger">required</span>}
                      </span>
                      <span className="text-xs text-ink-muted">{f.description}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
