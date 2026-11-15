import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Plus, Search, X } from 'lucide-react';
import { islepos, type IsleCustomer } from '../lib/islepos';
import { Avatar, cx, Spinner } from '../ui';
import { ClientDialog } from './IsleposPages';

/**
 * Search-or-add client field. Typing looks up the studio's IslePOS clients; if the person
 * isn't there, "Add …" opens the new-client form on top, and saving drops them straight back
 * into this field.
 */
export function ClientPicker({ value, onChange, autoFocus }: { value: IsleCustomer | null; onChange: (c: IsleCustomer | null) => void; autoFocus?: boolean }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<IsleCustomer[] | null>(null);
  const [active, setActive] = useState(0);
  const [adding, setAdding] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  // Look up as they type (debounced).
  useEffect(() => {
    if (!open) return;
    setResults(null);
    const t = setTimeout(() => {
      islepos
        .customers(query.trim(), 0, 8)
        .then((r) => {
          setResults(r.data);
          setActive(0);
        })
        .catch(() => setResults([]));
    }, 200);
    return () => clearTimeout(t);
  }, [query, open]);

  // The list floats above the dialog so its scrolling body can't clip it.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = boxRef.current?.getBoundingClientRect();
      if (r) setPos({ top: r.bottom + 6, left: r.left, width: r.width });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!boxRef.current?.contains(t) && !listRef.current?.contains(t)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open]);

  const typed = query.trim();
  const exact = !!results?.some((c) => c.name.toLowerCase() === typed.toLowerCase());
  const showAdd = typed.length > 0 && !exact;
  const options = results ?? [];
  const count = options.length + (showAdd ? 1 : 0);

  const choose = (c: IsleCustomer) => {
    onChange(c);
    setQuery('');
    setOpen(false);
  };
  const startAdd = () => {
    setOpen(false);
    setAdding(true);
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(count - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter' && open && count) {
      e.preventDefault();
      if (active < options.length) choose(options[active]);
      else startAdd();
    } else if (e.key === 'Escape' && open) {
      e.stopPropagation(); // close the list, not the dialog behind it
      setOpen(false);
    }
  };

  if (value)
    return (
      <div className="flex h-11 items-center gap-2.5 rounded-ctl border border-line bg-surface px-2.5">
        <Avatar name={value.name} size={26} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{value.name}</span>
          {(value.mobile || value.email) && <span className="block truncate text-2xs text-ink-3">{value.mobile || value.email}</span>}
        </span>
        <button
          type="button"
          aria-label="Change client"
          onClick={() => {
            onChange(null);
            setTimeout(() => inputRef.current?.focus(), 0);
          }}
          className="flex h-7 w-7 items-center justify-center rounded-full text-ink-3 hover:bg-sunken hover:text-ink"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );

  return (
    <>
      <div ref={boxRef} className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
        <input
          ref={inputRef}
          value={query}
          autoFocus={autoFocus}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          placeholder="Search or add a client"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          className="h-11 w-full rounded-ctl border border-line bg-surface pl-10 pr-3.5 text-[15px] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15 sm:text-sm"
        />
      </div>

      {open &&
        pos &&
        createPortal(
          <div
            ref={listRef}
            role="listbox"
            style={{ position: 'fixed', top: pos.top, left: pos.left, width: Math.max(pos.width, 260) }}
            className="z-[60] max-h-72 overflow-y-auto rounded-[12px] border border-line bg-surface p-1 shadow-float animate-fade-up"
          >
            {results === null ? (
              <div className="flex items-center gap-2 px-3 py-3 text-[13px] text-ink-3">
                <Spinner className="h-4 w-4" /> Searching clients…
              </div>
            ) : (
              <>
                {options.map((c, i) => (
                  <button
                    key={c.id}
                    type="button"
                    role="option"
                    aria-selected={i === active}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(c)}
                    className={cx('flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left', i === active ? 'bg-sunken' : '')}
                  >
                    <Avatar name={c.name} size={26} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{c.name}</span>
                      <span className="block truncate text-2xs text-ink-3">{[c.mobile, c.email].filter(Boolean).join(' · ') || 'No contact details'}</span>
                    </span>
                    {i === active && <Check className="h-3.5 w-3.5 text-ink-3" />}
                  </button>
                ))}
                {options.length === 0 && !showAdd && <p className="px-3 py-3 text-[13px] text-ink-3">No clients yet. Type a name to add one.</p>}
                {showAdd && (
                  <button
                    type="button"
                    role="option"
                    aria-selected={active === options.length}
                    onMouseEnter={() => setActive(options.length)}
                    onClick={startAdd}
                    className={cx(
                      'mt-0.5 flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2.5 text-left text-[13px] font-medium text-accent',
                      active === options.length ? 'bg-accent-soft' : '',
                      options.length > 0 && 'border-t border-line'
                    )}
                  >
                    <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-accent-soft">
                      <Plus className="h-4 w-4" />
                    </span>
                    Add “{typed}” as a new client
                  </button>
                )}
              </>
            )}
          </div>,
          document.body
        )}

      <ClientDialog
        client={null}
        initialName={typed}
        open={adding}
        onClose={() => {
          setAdding(false);
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
        onSaved={(c) => choose(c)}
      />
    </>
  );
}
