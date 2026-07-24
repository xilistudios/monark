import { useEffect, useRef } from "react";
import { useDispatch } from "react-redux";
import { lockVault } from "../redux/actions/vault";
import { store } from "../redux/store";

const AUTO_LOCK_DELAY_MS = 5 * 60 * 1000; // 5 minutes
const ACTIVITY_EVENTS = [
  "mousemove",
  "keydown",
  "click",
  "scroll",
  "touchstart",
  "mousedown",
];

/**
 * Auto-lock hook that locks all unlocked vaults after a period of inactivity.
 *
 * Tracks user activity (mouse, keyboard, touch, scroll) and resets a timer
 * on each event. When the timer expires (default 5 minutes), all unlocked
 * vaults are locked via Redux. The timer also resets when the document
 * visibility changes (tab switch / minimize).
 *
 * Uses a ref to snapshot the latest vaults array on timer expiry, avoiding
 * stale closures without re-subscribing listeners on every vault state change.
 */
export function useAutoLock() {
  const dispatch = useDispatch();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const lockAllVaults = () => {
      const { vaults } = store.getState().vault;
      for (const vault of vaults) {
        if (!vault.isLocked) {
          dispatch(lockVault(vault.id));
        }
      }
    };

    const resetTimer = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(lockAllVaults, AUTO_LOCK_DELAY_MS);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        resetTimer();
      }
    };

    // Start the initial timer
    resetTimer();

    // Listen for user activity
    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, resetTimer, { passive: true });
    }

    // Reset timer when tab becomes visible again
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, resetTimer);
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [dispatch]);
}
