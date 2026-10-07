import React, { useEffect, useState } from 'react';

type Item = { id: string; name: string; qty: number };
type StockList = { id: string; name: string; items: Item[] };
// Remembers which list an item came from, so "restocked" can put it back.
type RestockItem = Item & { fromListId: string | null };

type InventoryState = { lists: StockList[]; restock: RestockItem[] };

const STORAGE_KEY = 'pipboy:inventory';

const DEFAULT_STATE: InventoryState = {
  lists: [{ id: 'default', name: 'General', items: [] }],
  restock: [],
};

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

function loadState(): InventoryState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as InventoryState;
      if (Array.isArray(parsed.lists) && Array.isArray(parsed.restock) && parsed.lists.length > 0) return parsed;
    }
  } catch {
    // fall through to defaults on corrupt / unavailable storage
  }
  return DEFAULT_STATE;
}

const toQty = (value: string, min: number) => {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.max(min, n) : min;
};

type QtyControlProps = { qty: number; min: number; label: string; onChange: (qty: number) => void };

function QtyControl({ qty, min, label, onChange }: QtyControlProps) {
  return (
    <span className="inv-qty">
      <button type="button" className="inv-btn inv-btn--small" aria-label={`Decrease ${label}`} onClick={() => onChange(Math.max(min, qty - 1))}>−</button>
      <input
        type="number"
        className="inv-qty__input"
        aria-label={`Quantity of ${label}`}
        min={min}
        value={qty}
        onChange={(e) => onChange(toQty(e.target.value, min))}
      />
      <button type="button" className="inv-btn inv-btn--small" aria-label={`Increase ${label}`} onClick={() => onChange(qty + 1)}>+</button>
    </span>
  );
}

type AddFormProps = { placeholder: string; onAdd: (name: string, qty: number) => void };

function AddForm({ placeholder, onAdd }: AddFormProps) {
  const [name, setName] = useState('');
  const [qty, setQty] = useState('1');

  const submit = (evt: React.FormEvent) => {
    evt.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    onAdd(trimmed, toQty(qty, 1));
    setName('');
    setQty('1');
  };

  return (
    <form className="inv-add" onSubmit={submit}>
      <input
        type="text"
        className="inv-input"
        placeholder={placeholder}
        aria-label={placeholder}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        type="number"
        className="inv-input inv-input--qty"
        aria-label="Quantity"
        min={1}
        value={qty}
        onChange={(e) => setQty(e.target.value)}
      />
      <button type="submit" className="inv-btn">Add</button>
    </form>
  );
}

function InventoryTab() {
  const [{ lists, restock }, setState] = useState<InventoryState>(loadState);
  const [activeListId, setActiveListId] = useState<string>(() => loadState().lists[0].id);
  const [newListName, setNewListName] = useState('');

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ lists, restock }));
    } catch {
      // storage unavailable — inventory just won't persist
    }
  }, [lists, restock]);

  const activeList = lists.find((l) => l.id === activeListId) ?? lists[0];

  const updateActiveItems = (fn: (items: Item[]) => Item[]) =>
    setState((s) => ({ ...s, lists: s.lists.map((l) => (l.id === activeList.id ? { ...l, items: fn(l.items) } : l)) }));

  // ── lists ──
  const addList = (evt: React.FormEvent) => {
    evt.preventDefault();
    const name = newListName.trim();
    if (!name) return;
    const list: StockList = { id: newId(), name, items: [] };
    setState((s) => ({ ...s, lists: [...s.lists, list] }));
    setActiveListId(list.id);
    setNewListName('');
  };

  const deleteList = () => {
    if (lists.length <= 1) return;
    if (activeList.items.length > 0 && !window.confirm(`Delete "${activeList.name}" and its ${activeList.items.length} item(s)?`)) return;
    const remaining = lists.filter((l) => l.id !== activeList.id);
    setState((s) => ({ ...s, lists: remaining }));
    setActiveListId(remaining[0].id);
  };

  // ── stocked items ──
  const addStocked = (name: string, qty: number) =>
    updateActiveItems((items) => [...items, { id: newId(), name, qty }]);

  const setStockedQty = (id: string, qty: number) =>
    updateActiveItems((items) => items.map((i) => (i.id === id ? { ...i, qty } : i)));

  const removeStocked = (id: string) => updateActiveItems((items) => items.filter((i) => i.id !== id));

  // Moves an item (whole quantity) from the active list to the restock list.
  const markNeedsRestock = (item: Item) => {
    setState((s) => ({
      lists: s.lists.map((l) => (l.id === activeList.id ? { ...l, items: l.items.filter((i) => i.id !== item.id) } : l)),
      restock: [...s.restock, { ...item, fromListId: activeList.id }],
    }));
  };

  // ── restock items ──
  const addRestock = (name: string, qty: number) =>
    setState((s) => ({ ...s, restock: [...s.restock, { id: newId(), name, qty, fromListId: null }] }));

  const setRestockQty = (id: string, qty: number) =>
    setState((s) => ({ ...s, restock: s.restock.map((i) => (i.id === id ? { ...i, qty } : i)) }));

  const removeRestock = (id: string) => setState((s) => ({ ...s, restock: s.restock.filter((i) => i.id !== id) }));

  // Back to the list it came from (or the one being viewed if that's gone / unknown).
  const markRestocked = (item: RestockItem) => {
    setState((s) => {
      const targetId = s.lists.some((l) => l.id === item.fromListId) ? item.fromListId : activeList.id;
      return {
        lists: s.lists.map((l) => (l.id === targetId ? { ...l, items: [...l.items, { id: item.id, name: item.name, qty: item.qty }] } : l)),
        restock: s.restock.filter((i) => i.id !== item.id),
      };
    });
  };

  return (
    <div className="inv-layout">
      <nav className="inv-lists" aria-label="Inventory lists">
        <div className="inv-lists__names">
          {lists.map((list) => (
            <button
              key={list.id}
              type="button"
              className={`inv-lists__name ${list.id === activeList.id ? 'inv-lists__name--active' : ''}`}
              aria-pressed={list.id === activeList.id}
              onClick={() => setActiveListId(list.id)}
              title={list.name}
            >
              {list.name}
            </button>
          ))}
        </div>
        <form className="inv-lists__new" onSubmit={addList}>
          <input
            type="text"
            className="inv-input"
            placeholder="New list"
            aria-label="New list name"
            value={newListName}
            onChange={(e) => setNewListName(e.target.value)}
          />
        </form>
      </nav>

      <section className="inv-panel inv-panel--stock" aria-label={`In stock: ${activeList.name}`}>
        <header className="inv-panel__header">
          <span>IN STOCK · {activeList.name}</span>
          {lists.length > 1 && (
            <button type="button" className="inv-btn inv-btn--small" onClick={deleteList} title="Delete this list">Del list</button>
          )}
        </header>
        <ul className="inv-items">
          {activeList.items.length === 0 && <li className="inv-empty">EMPTY</li>}
          {activeList.items.map((item) => (
            <li key={item.id} className="inv-item">
              <span className="inv-item__name">{item.name}</span>
              <QtyControl qty={item.qty} min={0} label={item.name} onChange={(q) => setStockedQty(item.id, q)} />
              <button type="button" className="inv-btn inv-btn--small" onClick={() => markNeedsRestock(item)} title="Move to restock list">Restock →</button>
              <button type="button" className="inv-btn inv-btn--small" onClick={() => removeStocked(item.id)} aria-label={`Remove ${item.name}`}>✕</button>
            </li>
          ))}
        </ul>
        <AddForm placeholder="Add item" onAdd={addStocked} />
      </section>

      <section className="inv-panel inv-panel--restock" aria-label="Needs restocking">
        <header className="inv-panel__header"><span>NEEDS RESTOCK</span></header>
        <ul className="inv-items">
          {restock.length === 0 && <li className="inv-empty">NOTHING NEEDED</li>}
          {restock.map((item) => (
            <li key={item.id} className="inv-item">
              <span className="inv-item__name">{item.name}</span>
              <QtyControl qty={item.qty} min={1} label={item.name} onChange={(q) => setRestockQty(item.id, q)} />
              <button type="button" className="inv-btn inv-btn--small" onClick={() => markRestocked(item)} title="Move back to its stock list">← Got it</button>
              <button type="button" className="inv-btn inv-btn--small" onClick={() => removeRestock(item.id)} aria-label={`Remove ${item.name}`}>✕</button>
            </li>
          ))}
        </ul>
        <AddForm placeholder="Add to restock" onAdd={addRestock} />
      </section>
    </div>
  );
}

export { InventoryTab };
