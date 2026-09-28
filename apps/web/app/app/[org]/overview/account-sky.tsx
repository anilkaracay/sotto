"use client";

// The overview's confidential account card (09 section 3; step 1.10): the design's sky card with the
// owner's wUSDC token account address (public) and "Sealed", read from chain through the
// confidential session. An account that is not set up says so and links to Account setup.
import Link from "next/link";
import { useId, type ReactNode } from "react";
import { useConfidential } from "../../_components/confidential/context.tsx";
import styles from "./overview.module.css";

function Lock() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="5" y="11" width="14" height="10" rx="2.5" />
      <path d="M8 11V8a4 4 0 018 0v3" />
    </svg>
  );
}

export function AccountSky({ orgName }: { orgName: string }) {
  const { orgId, network, ready, data } = useConfidential();
  const art = useId().replace(/:/g, "");
  const configured = data.wusdc?.status === "present" && data.wusdc.confidential !== null;
  const address = configured ? (data.wusdcAccount ?? null) : null;

  let text: ReactNode;
  if (!ready) {
    text =
      network.check.status === "wrapped_missing" ? (
        <>
          The wrapped USDC mint does not exist on this network yet.{" "}
          <Link href={`/app/${orgId}/setup`}>Open the setup page</Link>
        </>
      ) : (
        "Your account cannot be read while the network check above fails."
      );
  } else if (data.error) text = data.error;
  else if (data.loading && !data.wusdc) text = "Reading your account from the network…";
  else if (configured) {
    text = "Its balances are encrypted onchain. Only the keys your wallet derives can read them.";
  } else {
    text = (
      <>
        Set up your confidential wUSDC account to send and receive encrypted payments.{" "}
        <Link href={`/app/${orgId}/setup`}>Open the setup page</Link>
      </>
    );
  }

  return (
    <section
      className={styles.sky}
      data-testid="account-sky"
      data-state={configured ? "set_up" : "not_set_up"}
    >
      <svg
        className={styles.skyArt}
        viewBox="0 0 600 420"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={`${art}g`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#3F7ED6" />
            <stop offset=".6" stopColor="#8CBDF0" />
            <stop offset="1" stopColor="#DCEBFA" />
          </linearGradient>
          <filter id={`${art}f`} x="0" y="0" width="100%" height="100%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency=".006 .014"
              numOctaves={6}
              seed={9}
              result="n"
            />
            <feColorMatrix
              in="n"
              type="matrix"
              values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  3.1 0 0 0 -1.35"
            />
            <feGaussianBlur stdDeviation=".8" />
          </filter>
        </defs>
        <rect width="600" height="420" fill={`url(#${art}g)`} />
        <rect y="140" width="600" height="280" filter={`url(#${art}f)`} opacity=".95" />
      </svg>
      <div className={styles.skyText}>
        <h2>Your confidential account</h2>
        <p role="status">{text}</p>
      </div>
      <div className={styles.account}>
        <div className={styles.accountTop}>
          <span className={styles.mark} aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 26 26">
              <circle cx="13" cy="13" r="10.5" fill="none" stroke="#FFFFFF" strokeWidth="2.6" />
              <path d="M13 2.5a10.5 10.5 0 000 21z" fill="#FFFFFF" />
            </svg>
          </span>
          <span>Sotto</span>
          <span className={styles.kind}>Business</span>
        </div>
        <div
          className={`${styles.number} mono`}
          title={address ?? undefined}
          data-testid="account-address"
        >
          {address ? `${address.slice(0, 4)} •••• ${address.slice(-4)}` : "Not set up yet"}
        </div>
        <div className={styles.accountBottom}>
          <span>{orgName}</span>
          {configured ? (
            <span className={styles.sealed}>
              <Lock />
              Sealed
            </span>
          ) : null}
        </div>
      </div>
    </section>
  );
}
