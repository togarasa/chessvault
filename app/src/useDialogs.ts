import { useState } from "react";
import { Ask, Field, MenuItem } from "./Dialog";

export type Menu = { x: number; y: number; items: MenuItem[] };

/// The question and the right-click menu shown over the window, at most one of each.
export function useDialogs() {
  const [ask, setAsk] = useState<Ask | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);

  /// Asks a question with `choices`, or for text when `text` is set. Resolves to the answer, or null when cancelled.
  function askUser(question: Omit<Ask, "answer" | "fields">): Promise<string | null> {
    return new Promise((resolve) =>
      setAsk({
        ...question,
        answer: (value) => {
          setAsk(null);
          resolve(value);
        },
      }),
    );
  }

  /// Shows a form. Resolves to the field values, or null when cancelled.
  function askFields(title: string, fields: Field[]): Promise<Record<string, string> | null> {
    return new Promise((resolve) =>
      setAsk({
        title,
        fields,
        answer: (value, values) => {
          setAsk(null);
          resolve(value && values ? values : null);
        },
      }),
    );
  }

  return {
    ask,
    menu,
    askUser,
    askFields,
    openMenu: setMenu,
    closeMenu: () => setMenu(null),
    /// Whether a question or menu is open, so keys should not move through the game.
    busy: ask !== null || menu !== null,
  };
}

export type Dialogs = ReturnType<typeof useDialogs>;
