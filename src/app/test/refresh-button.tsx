"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import styles from "./test.module.css";

export function RefreshButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function refresh() {
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      className={styles.primaryAction}
      onClick={refresh}
      disabled={isPending}
      aria-busy={isPending}
    >
      {isPending ? "Obnovuji…" : "Obnovit data"}
    </button>
  );
}
