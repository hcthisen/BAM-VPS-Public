"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

const REFRESH_INTERVAL_MS = 10_000;
const MIN_SHARED_REFRESH_MS = 9_000;
const EDIT_PAUSE_MS = 30_000;
const STORAGE_KEY = "bam:last-auto-refresh-at";

function readLastSharedRefreshAt() {
  const value = Number(window.localStorage.getItem(STORAGE_KEY));
  return Number.isFinite(value) ? value : 0;
}

function isEditableElement(element: Element | null) {
  if (!element) return false;
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    return true;
  }
  return element instanceof HTMLElement && element.isContentEditable;
}

export function AutoRefresh() {
  const router = useRouter();
  const pathname = usePathname();
  const lastEditAtRef = useRef(0);

  useEffect(() => {
    const markEdit = () => {
      lastEditAtRef.current = Date.now();
    };

    window.addEventListener("input", markEdit, true);
    window.addEventListener("change", markEdit, true);
    return () => {
      window.removeEventListener("input", markEdit, true);
      window.removeEventListener("change", markEdit, true);
    };
  }, []);

  useEffect(() => {
    let timeoutId: number | undefined;

    const canRefresh = () => {
      if (document.hidden || !navigator.onLine || isEditableElement(document.activeElement)) {
        return false;
      }
      return Date.now() - lastEditAtRef.current >= EDIT_PAUSE_MS;
    };

    const schedule = (delay = REFRESH_INTERVAL_MS) => {
      window.clearTimeout(timeoutId);
      const jitter = Math.floor(Math.random() * 1_000);
      timeoutId = window.setTimeout(refreshIfAllowed, delay + jitter);
    };

    const refreshIfAllowed = () => {
      if (!canRefresh()) {
        schedule();
        return;
      }

      const now = Date.now();
      const lastSharedRefreshAt = readLastSharedRefreshAt();
      if (lastSharedRefreshAt && now - lastSharedRefreshAt < MIN_SHARED_REFRESH_MS) {
        schedule(MIN_SHARED_REFRESH_MS - (now - lastSharedRefreshAt));
        return;
      }

      window.localStorage.setItem(STORAGE_KEY, String(now));
      router.refresh();
      schedule();
    };

    const refreshWhenVisible = () => {
      if (!document.hidden) {
        schedule(0);
      }
    };

    schedule();
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("online", refreshWhenVisible);

    return () => {
      window.clearTimeout(timeoutId);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("online", refreshWhenVisible);
    };
  }, [pathname, router]);

  return null;
}
