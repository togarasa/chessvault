import { useEffect, useRef, useState } from "react";

/// A field in a form dialog; with `options` it is a drop-down list.
export type Field = { name: string; value: string; options?: string[]; hint?: string };

/// A question shown over the window. With `text` set it asks for text, with `fields` it is a form
/// whose answer is "ok" plus the field values; otherwise it offers `choices`.
export type Ask = {
  title: string;
  choices?: { label: string; value: string }[];
  text?: string;
  fields?: Field[];
  answer: (value: string | null, fields?: Record<string, string>) => void;
};

export function Dialog({ ask }: { ask: Ask }) {
  const [text, setText] = useState(ask.text ?? "");
  const [values, setValues] = useState(() => Object.fromEntries((ask.fields ?? []).map((f) => [f.name, f.value])));
  const first = useRef<HTMLButtonElement & HTMLTextAreaElement & HTMLInputElement>(null);

  useEffect(() => {
    first.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") ask.answer(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ask]);

  return (
    <div className="overlay" onMouseDown={() => ask.answer(null)}>
      <div className="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <strong>{ask.title}</strong>
        {ask.fields ? (
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              ask.answer("ok", values);
            }}
          >
            {ask.fields.map((f, i) => (
              <label key={f.name}>
                {f.name}
                {f.options ? (
                  <select
                    aria-label={f.name}
                    value={values[f.name]}
                    onChange={(e) => setValues({ ...values, [f.name]: e.currentTarget.value })}
                  >
                    {f.options.map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    ref={i === 0 ? first : undefined}
                    value={values[f.name]}
                    onChange={(e) => setValues({ ...values, [f.name]: e.currentTarget.value })}
                  />
                )}
                {f.hint && <small>{f.hint}</small>}
              </label>
            ))}
            <div className="actions">
              <button type="submit">OK</button>
              <button type="button" onClick={() => ask.answer(null)}>
                Cancel
              </button>
            </div>
          </form>
        ) : ask.text !== undefined ? (
          <>
            <textarea
              ref={first}
              value={text}
              onChange={(e) => setText(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  ask.answer(text);
                }
              }}
              rows={4}
            />
            <div className="actions">
              <button onClick={() => ask.answer(text)}>OK</button>
              <button onClick={() => ask.answer(null)}>Cancel</button>
            </div>
          </>
        ) : (
          <div className="choices">
            {ask.choices?.map((c, i) => (
              <button key={c.value} ref={i === 0 ? first : undefined} onClick={() => ask.answer(c.value)}>
                {c.label}
              </button>
            ))}
            <button onClick={() => ask.answer(null)}>Cancel</button>
          </div>
        )}
      </div>
    </div>
  );
}

/// An entry in a right-click menu. A row of `buttons` shows several small choices side by side, such as move symbols.
export type MenuItem =
  | { label: string; action: () => void; disabled?: boolean }
  | { buttons: { label: string; action: () => void; active?: boolean }[] }
  | "separator";

/// A right-click menu at a point on the screen.
export function ContextMenu({ x, y, items, close }: { x: number; y: number; items: MenuItem[]; close: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  return (
    <div className="menu-overlay" onMouseDown={close} onContextMenu={(e) => (e.preventDefault(), close())}>
      <div
        className="menu"
        style={{ left: Math.min(x, window.innerWidth - 230), top: Math.max(8, Math.min(y, window.innerHeight - 30 * items.length)) }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {items.map((item, i) =>
          item === "separator" ? (
            <hr key={i} />
          ) : "buttons" in item ? (
            <div key={i} className="menu-row">
              {item.buttons.map((b) => (
                <button
                  key={b.label}
                  className={b.active ? "active" : ""}
                  onClick={() => {
                    close();
                    b.action();
                  }}
                >
                  {b.label}
                </button>
              ))}
            </div>
          ) : (
            <button
              key={i}
              disabled={item.disabled}
              onClick={() => {
                close();
                item.action();
              }}
            >
              {item.label}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
