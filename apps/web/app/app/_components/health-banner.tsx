"use client";

// The shell's banner on every /app page (F-19, AC-19.1; D-14; step 2.9). When the server could not reach
// the network, it says so and reads the page again every 15 seconds; when the worker's last verdict on the
// ZK ElGamal Proof program failed, or there has been no success for 15 minutes, it says that confidential
// actions are paused and that the funds are safe.
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import {
  healthState,
  PROGRAM_TITLE,
  programDetail,
  UNREACHABLE_TITLE,
  unreachableDetail,
} from "../../../lib/health.ts";
import type { NetworkView } from "../../../lib/server/network-view.ts";
import styles from "./health-banner.module.css";

export const RETRY_MS = 15_000;

export function HealthBanner({ network }: { network: NetworkView }) {
  const router = useRouter();
  const state = healthState(network);
  useEffect(() => {
    if (state !== "unreachable") return;
    const timer = window.setInterval(() => router.refresh(), RETRY_MS);
    return () => window.clearInterval(timer);
  }, [state, router]);
  return <HealthBannerView network={network} />;
}

/** The banner's markup (exported for the component tests). */
export function HealthBannerView({ network }: { network: NetworkView }) {
  const state = healthState(network);
  if (state === "ok") return null;
  const unreachable = state === "unreachable";
  return (
    <div
      className={unreachable ? `${styles.banner} ${styles.retrying}` : styles.banner}
      role={unreachable ? "status" : "alert"}
      data-testid={unreachable ? "network-unreachable" : "proof-program-banner"}
    >
      <b>{unreachable ? UNREACHABLE_TITLE : PROGRAM_TITLE}</b>
      <span>{unreachable ? unreachableDetail(network.label) : programDetail(network.label)}</span>
    </div>
  );
}
