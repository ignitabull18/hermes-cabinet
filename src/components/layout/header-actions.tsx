"use client";

import { Search } from "lucide-react";
import { ToolbarButton } from "@/components/layout/toolbar-button";
import { useHermesMode } from "@/hooks/use-cabinet-runtime-mode";

/**
 * Global header actions shared across all file-type toolbars. Just the search
 * affordance now (⌘K in the tooltip). The AI Editor drawer opens from the split
 * "New" button (see NewTaskButton) on KB pages or via ⌘⌥A; the theme picker
 * lives on the home header + Settings → Appearance.
 */
export function HeaderActions() {
  const hermesMode = useHermesMode();
  return (
    <ToolbarButton
      icon={Search}
      label={hermesMode ? "Content search unavailable" : "Search"}
      title={hermesMode
        ? "Content search is unavailable in Hermes mode because it requires the legacy Cabinet daemon."
        : "Search (⌘K)"}
      iconOnly
      disabled={hermesMode}
      className={hermesMode ? "disabled:pointer-events-auto" : undefined}
      onClick={() => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: "k", metaKey: true })
        );
      }}
    />
  );
}
