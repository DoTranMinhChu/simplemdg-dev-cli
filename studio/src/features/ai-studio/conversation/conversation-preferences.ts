import { useCallback, useEffect, useState } from "react";

export type TConversationDensity = "readable" | "compact" | "raw";
export type TFocusMode = "conversation" | "execution" | "combined";

export type TReaderSettings = {
  textSize: "sm" | "md" | "lg";
  contentWidth: "narrow" | "normal" | "wide";
  showToolActivity: boolean;
  showTimestamps: boolean;
  compact: boolean;
};

export type TConversationPreferences = {
  density: TConversationDensity;
  focusMode: TFocusMode;
  reader: TReaderSettings;
};

const STORAGE_KEY = "ai-studio:conversation-prefs";

const DEFAULT_PREFERENCES: TConversationPreferences = {
  density: "readable",
  focusMode: "combined",
  reader: { textSize: "md", contentWidth: "normal", showToolActivity: true, showTimestamps: true, compact: false },
};

function loadPreferences(): TConversationPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<TConversationPreferences>;
    return { ...DEFAULT_PREFERENCES, ...parsed, reader: { ...DEFAULT_PREFERENCES.reader, ...parsed.reader } };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

/** Persists density/focus-mode/reader settings to localStorage — no state-management dependency needed for this. */
export function useConversationPreferences(): {
  preferences: TConversationPreferences;
  setDensity: (density: TConversationDensity) => void;
  setFocusMode: (mode: TFocusMode) => void;
  updateReader: (patch: Partial<TReaderSettings>) => void;
} {
  const [preferences, setPreferences] = useState<TConversationPreferences>(() => loadPreferences());

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  }, [preferences]);

  const setDensity = useCallback((density: TConversationDensity) => setPreferences((prev) => ({ ...prev, density })), []);
  const setFocusMode = useCallback((focusMode: TFocusMode) => setPreferences((prev) => ({ ...prev, focusMode })), []);
  const updateReader = useCallback((patch: Partial<TReaderSettings>) => setPreferences((prev) => ({ ...prev, reader: { ...prev.reader, ...patch } })), []);

  return { preferences, setDensity, setFocusMode, updateReader };
}
