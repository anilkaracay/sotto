"use client";

// The signed in app shell (09 sections 1 and 2): logo, top pill nav (only built screens, rule 6; client
// side links, so the tab's keys survive the navigation), the network label (13 A25) and the org and role
// switcher, which lists the user's own memberships and never impersonates anyone (09 section 1, 13 A9).
// An owned organization links to its onboarding status; Sotto admins also get the business review
// console. Signing out ends the tab's keys.
import { Chip, TopNav, type TopNavItem } from "@sotto/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { signOut } from "../../../lib/client/auth.ts";
import { shortWallet } from "../../../lib/format.ts";
import { orgStatusLabel } from "../../../lib/org.ts";
import type { MeView } from "../../../lib/server/me.ts";
import { useKeySession } from "./key-session.tsx";
import { Logo } from "./logo.tsx";
import styles from "./shell.module.css";

const ROLE_LABEL: Record<MeView["memberships"][number]["role"], string> = {
  owner: "Owner",
  approver: "Approver",
  accountant: "Accountant",
  board: "Board",
  recipient: "Recipient",
};

export function AppShell({
  me,
  network,
  nav = [],
  children,
}: {
  me: MeView;
  network: string;
  nav?: readonly TopNavItem[];
  children: ReactNode;
}) {
  const router = useRouter();
  const keys = useKeySession();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const menuId = useId();
  const menu = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    const onClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  const name = me.user.displayName ?? shortWallet(me.user.wallet);
  const initials = (me.user.displayName ?? me.user.wallet).slice(0, 2).toUpperCase();

  return (
    <div className={styles.shell}>
      <header className={styles.top}>
        <Logo />
        <div className={styles.middle}>
          <TopNav items={nav} link={Link} />
        </div>
        <div className={styles.right}>
          <Chip tone="blue" data-testid="network-label">
            {network}
          </Chip>
          <button
            ref={button}
            type="button"
            className={styles.avatar}
            aria-label="Account and organizations"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-controls={menuId}
            onClick={() => setOpen((value) => !value)}
          >
            {initials}
          </button>
        </div>
        {open ? (
          <div
            ref={menu}
            id={menuId}
            className={styles.menu}
            role="menu"
            aria-label="Account and organizations"
          >
            <div className={styles.menuHead}>Signed in as</div>
            <div className={styles.row}>
              <span className={styles.orgMark} aria-hidden="true">
                {initials}
              </span>
              <span className={styles.text}>
                <b>{name}</b>
                <small className={`mono ${styles.address}`} data-testid="signed-in-wallet">
                  {me.user.wallet}
                </small>
              </span>
            </div>
            <div className={styles.menuHead}>Your organizations</div>
            {me.memberships.length === 0 ? (
              <div className={styles.empty}>No organization yet</div>
            ) : (
              me.memberships.map((membership) => {
                const content = (
                  <>
                    <span className={styles.orgMark} aria-hidden="true">
                      {membership.orgName.slice(0, 2).toUpperCase()}
                    </span>
                    <span className={styles.text}>
                      <b>{membership.orgName}</b>
                      <small>{ROLE_LABEL[membership.role]}</small>
                    </span>
                    {membership.orgStatus !== "active" ? (
                      <Chip
                        className={styles.side}
                        tone={membership.orgStatus === "suspended" ? "red" : "amber"}
                      >
                        {orgStatusLabel(membership.orgStatus)}
                      </Chip>
                    ) : null}
                  </>
                );
                const key = `${membership.orgId}:${membership.role}`;
                return membership.role === "owner" ? (
                  <Link
                    key={key}
                    href="/app/onboarding"
                    className={`${styles.row} ${styles.link}`}
                    role="menuitem"
                    onClick={() => setOpen(false)}
                  >
                    {content}
                  </Link>
                ) : (
                  <div key={key} className={styles.row} role="menuitem">
                    {content}
                  </div>
                );
              })
            )}
            {me.isAdmin ? (
              <>
                <div className={styles.menuHead}>Sotto admin</div>
                <Link
                  href="/app/admin"
                  className={`${styles.row} ${styles.link}`}
                  role="menuitem"
                  onClick={() => setOpen(false)}
                >
                  <span className={styles.text}>
                    <b>Business review</b>
                    <small>Approve, reject and suspend organizations</small>
                  </span>
                </Link>
              </>
            ) : null}
            <button
              type="button"
              role="menuitem"
              className={styles.signOut}
              disabled={signingOut}
              onClick={async () => {
                setSigningOut(true);
                // Signing out ends the tab's keys first (10 section 3).
                keys.session.signOut();
                try {
                  await signOut();
                } finally {
                  router.replace("/app/sign-in");
                  router.refresh();
                }
              }}
            >
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        ) : null}
      </header>
      <main className={styles.body}>{children}</main>
    </div>
  );
}
