"use client";

import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import { Popover } from "./Popover";

export interface MenuItem {
  id: string;
  label: string;
  icon?: IconName;
  hint?: string;
  danger?: boolean;
  checked?: boolean;
  /** Leave the menu open after selecting (for switching to a sub-view). */
  keepOpen?: boolean;
  onSelect: () => void;
}

interface MenuProps {
  items: (MenuItem | "divider")[];
  onClose: () => void;
  label: string;
  align?: "left" | "right";
  below?: boolean;
  header?: ReactNode;
  className?: string;
}

/** Slack-style context menu: a list of actions in a popover. */
export function Menu({ items, onClose, label, align = "right", below = true, header, className = "" }: MenuProps) {
  return (
    <Popover onClose={onClose} label={label} align={align} below={below} className={`w-[260px] py-1 ${className}`}>
      {header && <div className="border-b border-line px-3.5 py-2 text-[13px] font-semibold text-muted">{header}</div>}
      {items.map((item, i) =>
        item === "divider" ? (
          <div key={`d${i}`} className="my-1 h-px bg-line" />
        ) : (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            onClick={() => {
              item.onSelect();
              if (!item.keepOpen) onClose();
            }}
            className={`flex w-full items-center gap-3 px-3.5 py-2 text-left text-[15px] hover:bg-hover ${item.danger ? "text-new" : "text-ink"}`}
          >
            {item.icon ? <Icon name={item.icon} size={18} /> : <span className="w-[18px]" />}
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{item.label}</span>
              {item.hint && <span className="block truncate text-[12px] text-muted">{item.hint}</span>}
            </span>
            {item.checked && <Icon name="check" size={16} strokeWidth={2.4} className="text-link" />}
          </button>
        ),
      )}
    </Popover>
  );
}
