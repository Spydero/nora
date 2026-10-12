"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError } from "./api";
import { type AnswerValue, checksApi, type CheckView, type ConsentNotice, CURRENT_CHECK_KEY, NEW_CHECK_EVENT, STAGE_LABELS } from "./checks";

const POLL_MS = 700;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface CheckController {
  check: CheckView | null;
  stage: string | null;
  error: string | null;
  busy: boolean;
  consent: ConsentNotice | null;
  /** The finished check the next new check will follow up, if the patient chose "Recheck". */
  followUp: { id: string; title: string | null } | null;
  start(text: string): Promise<void>;
  send(text: string): Promise<void>;
  answer(value: AnswerValue): Promise<void>;
  acceptConsent(): Promise<void>;
  acknowledge(itemId: string, done: boolean): Promise<void>;
  open(id: string): Promise<void>;
  recheck(): void;
  reset(): void;
}

function message(error: unknown): string {
  return error instanceof ApiError ? error.message : "Something went wrong. Please try again.";
}

export function useCheck(): CheckController {
  const [check, setCheck] = useState<CheckView | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState<ConsentNotice | null>(null);
  const [pendingText, setPendingText] = useState<string | null>(null);
  const [followUp, setFollowUp] = useState<CheckController["followUp"]>(null);

  const adopt = useCallback((view: CheckView) => {
    sessionStorage.setItem(CURRENT_CHECK_KEY, view.id);
    setCheck(view);
  }, []);

  const reset = useCallback(() => {
    sessionStorage.removeItem(CURRENT_CHECK_KEY);
    setCheck(null);
    setStage(null);
    setError(null);
    setConsent(null);
    setPendingText(null);
    setFollowUp(null);
  }, []);

  const recheck = useCallback(() => {
    const from = check ? { id: check.id, title: check.title } : null;
    reset();
    setFollowUp(from);
  }, [check, reset]);

  useEffect(() => {
    const id = sessionStorage.getItem(CURRENT_CHECK_KEY);
    if (id) {
      checksApi
        .get(id)
        .then(setCheck)
        .catch((err) => {
          if (err instanceof ApiError && err.status === 404) sessionStorage.removeItem(CURRENT_CHECK_KEY);
          else setError("Nora couldn’t load your current check. Refresh the page to try again.");
        });
    }
    window.addEventListener(NEW_CHECK_EVENT, reset);
    return () => window.removeEventListener(NEW_CHECK_EVENT, reset);
  }, [reset]);

  const checkId = check?.id;
  const assessing = check?.status === "ASSESSING";
  const fromSequence = check?.lastEventSequence;

  useEffect(() => {
    if (!checkId || !assessing || !fromSequence) return;
    let cancelled = false;
    let after = fromSequence;
    void (async () => {
      let failures = 0;
      while (!cancelled) {
        try {
          const batch = await checksApi.events(checkId, after);
          failures = 0;
          for (const event of batch.events) {
            after = event.sequence;
            if (event.type === "stage" && event.payload.stage) setStage(STAGE_LABELS[event.payload.stage] ?? null);
          }
          if (batch.status !== "ASSESSING") {
            const view = await checksApi.get(checkId);
            if (!cancelled) {
              setStage(null);
              setCheck(view);
            }
            return;
          }
        } catch (err) {
          failures += 1;
          if (failures >= 5 && !cancelled) {
            setError(message(err));
            return;
          }
        }
        await sleep(POLL_MS);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [checkId, assessing, fromSequence]);

  const run = useCallback(async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }, []);

  const begin = useCallback(
    async (text: string) => {
      try {
        const created = await checksApi.create(followUp?.id);
        setStage(STAGE_LABELS.started ?? null);
        adopt(await checksApi.send(created.id, text));
        setPendingText(null);
        setFollowUp(null);
      } catch (err) {
        if (err instanceof ApiError && err.code === "CONSENT_REQUIRED") {
          const notices = await checksApi.consents();
          setPendingText(text);
          setConsent(notices.find((n) => n.purpose === "PROCESSING") ?? null);
          return;
        }
        throw err;
      }
    },
    [adopt, followUp],
  );

  const start = useCallback((text: string) => run(() => begin(text)), [run, begin]);

  const send = useCallback(
    (text: string) =>
      run(async () => {
        if (!check) return begin(text);
        setStage(STAGE_LABELS.started ?? null);
        adopt(await checksApi.send(check.id, text));
      }),
    [run, begin, check, adopt],
  );

  const answer = useCallback(
    (value: AnswerValue) =>
      run(async () => {
        if (!check?.pendingQuestion) return;
        setStage(STAGE_LABELS.started ?? null);
        try {
          adopt(await checksApi.answer(check.id, check.pendingQuestion.id, check.inputVersion, value));
        } catch (err) {
          if (err instanceof ApiError && err.code === "STALE_INPUT") adopt(await checksApi.get(check.id));
          throw err;
        }
      }),
    [run, check, adopt],
  );

  const acceptConsent = useCallback(
    () =>
      run(async () => {
        if (!consent) return;
        await checksApi.grantConsent(consent.purpose);
        setConsent(null);
        if (pendingText) await begin(pendingText);
      }),
    [run, consent, pendingText, begin],
  );

  const acknowledge = useCallback(
    async (itemId: string, done: boolean) => {
      if (!check) return;
      setCheck({ ...check, carePlanDone: done ? [...check.carePlanDone, itemId] : check.carePlanDone.filter((i) => i !== itemId) });
      try {
        setCheck(await checksApi.acknowledge(check.id, itemId, done));
      } catch (err) {
        setCheck(check);
        setError(message(err));
      }
    },
    [check],
  );

  const open = useCallback((id: string) => run(async () => adopt(await checksApi.get(id))), [run, adopt]);

  return { check, stage, error, busy, consent, followUp, start, send, answer, acceptConsent, acknowledge, open, recheck, reset };
}
