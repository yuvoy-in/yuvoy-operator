"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { acceptRequest, declineRequest } from "@/app/bookings/actions";
import {
  createAnswerStore,
  type Answer,
  type AnswerStore,
} from "./answer-store";

const NONE: Readonly<Record<string, Answer>> = {};

/**
 * The answers a list is holding, sending and showing receipts for.
 *
 * One store per list (Home's Needs you, Bookings' queue), made once and kept
 * for as long as the list is mounted, which is what lets a receipt outlive the
 * server re-render that removes its request. `onSettled` re-reads the list
 * beneath once an answer lands.
 *
 * Held answers are SENT, not dropped, when the list goes away or the page is
 * hidden: see `answer-store.ts`.
 */
export function useAnswers(onSettled?: () => void): {
  answers: Readonly<Record<string, Answer>>;
  store: AnswerStore;
} {
  const [store] = useState(() =>
    createAnswerStore({ accept: acceptRequest, decline: declineRequest }),
  );
  const answers = useSyncExternalStore(store.subscribe, store.get, () => NONE);

  useEffect(() => {
    store.onSettled(onSettled ?? null);
  }, [store, onSettled]);

  useEffect(() => {
    /*
      `visibilitychange` to hidden covers a locked phone and a switched app,
      the two ways a held answer's five seconds most often run out unseen;
      `pagehide` covers the tab going. Either way the answer is the operator's
      decision, so it goes now rather than whenever the timers next run.
    */
    const onHidden = () => {
      if (document.visibilityState === "hidden") store.flush();
    };
    const onPageHide = () => store.flush();
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onPageHide);
      // Leaving the list: nothing to re-read, and nothing held is dropped.
      store.onSettled(null);
      store.flush();
    };
  }, [store]);

  return { answers, store };
}
