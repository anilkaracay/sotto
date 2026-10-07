"use client";

// The landing's interactive state (F-17, step 3.1), ported from the approved design's component
// (the approved landing design, landing v8): the hero's public and accountant views on a timer, the
// four views of the ledger, the three steps, the proof illustration, the SDK tabs, the FAQ filter,
// the hero tilt and the footer watermark. The data is the design's with the approved copy
// corrections and the founder's rules of 2026-09-30 applied. Every
// figure here belongs to an illustration with sample data; nothing is read from Sotto or the chain.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent,
} from "react";

const FAQ_CATEGORIES = ["All", "Privacy", "Payments", "Compliance", "Security"] as const;
const FAQ_CATEGORY = ["Privacy", "Privacy", "Payments", "Payments", "Compliance", "Security"];

const PRIMITIVES = [
  ["Sealed payouts", "Pay one person or a whole run. Amounts are encrypted onchain.", "payroll.ts"],
  ["Viewing keys", "Invite a reader with a scope, and seal each record for them.", "keys.ts"],
  ["Proofs", "Prove a statement about a sealed balance without revealing it.", "proof.ts"],
] as const;

const THRESHOLDS = [
  { value: 100_000, label: "$100k", full: "$100,000" },
  { value: 500_000, label: "$500k", full: "$500,000" },
  { value: 1_000_000, label: "$1M", full: "$1,000,000" },
  { value: 2_500_000, label: "$2.5M", full: "$2,500,000" },
];
const DEFAULT_THRESHOLD = { value: 1_000_000, label: "$1M", full: "$1,000,000" };
const TARGETS = ["Atlas Freight", "Your landlord", "Northbank credit desk"];
/** The illustration's sealed balance, the same sample figure the other sections show. */
const SAMPLE_BALANCE = 1_840_300;
const SCALE_MAX = 2_800_000;

const ROLES = [
  {
    id: "public",
    label: "Anyone",
    avatar: "av5 pho u-anyone",
    note: "Anyone with a block explorer sees that payments happened and where they went. Never how much.",
  },
  {
    id: "team",
    label: "Maya",
    avatar: "av5 pho u-maya",
    note: "Maya, your design lead, sees her own salary and nothing else.",
  },
  {
    id: "accountant",
    label: "Accountant",
    avatar: "av5 pho u-acct",
    note: "Your accountant sees every amount, reconciles every payment and exports the books.",
  },
  {
    id: "counterparty",
    label: "Supplier",
    avatar: "av5 pho u-atlas",
    note: "Atlas Freight sees the answer to the one question you chose to prove.",
  },
] as const;
const OPEN_BY: Record<string, string[]> = {
  public: [],
  team: ["maya"],
  accountant: ["maya", "idris", "supplier", "payout", "treasury", "proof"],
  counterparty: ["proof"],
};

const STEPS = [
  {
    title: "Seal your dollars",
    desc: "Move USDC into your account. It becomes a confidential balance on Solana, still one to one with the dollar.",
  },
  // The hackathon build records the owner's approval with each run.
  {
    title: "Pay the usual way",
    desc: "Upload a payroll file or pay an invoice. Every run is approved and recorded in Sotto, and the owner wallet executes it.",
  },
  {
    title: "Share access, not data",
    desc: "Give your accountant or auditor the view they need. Revoke it when the work is done.",
  },
];

const GROUPS = [
  {
    id: "public",
    tag: "Public",
    title: "Who, to whom, and when",
    desc: "Anyone can verify that the payment happened. That is what keeps it honest.",
  },
  {
    id: "sealed",
    tag: "Sealed",
    title: "How much, and why",
    desc: "Amounts and memos open only with a key you hand out: your accountant, an auditor, a regulator.",
  },
  {
    id: "checked",
    tag: "Checked",
    title: "Before a dollar moves",
    desc: "The business is verified, the recipient is screened, and the funds never leave your custody.",
  },
] as const;

/**
 * The proof illustration's certificate words for a sample balance and a threshold (Proven or
 * Not proven, never True or False; L2 and L19: no "one transaction").
 */
export function proofWords(proven: boolean) {
  return proven
    ? { result: "Proven", sub: "The statement holds. The balance stays sealed." }
    : {
        result: "Not proven",
        sub: "This statement could not be proven. Nothing else was revealed.",
      };
}

export function useLanding() {
  const [s, set] = useState({
    sdk: 0,
    sdkAuto: true,
    faqCategory: "All" as (typeof FAQ_CATEGORIES)[number],
    scanN: -1,
    faqOpen: 0,
    highlight: "public" as (typeof GROUPS)[number]["id"],
    highlightAuto: true,
    tx: 0,
    ty: 0,
    open: false,
    auto: true,
    fx: 0,
    fy: 0,
    footManual: false,
    split: 54,
    role: "public" as (typeof ROLES)[number]["id"],
    proof: "idle" as "idle" | "run" | "done",
    threshold: 2,
    target: 0,
    step: 0,
    stepAuto: true,
  });
  const update = useCallback(
    (patch: Partial<typeof s>) => set((prev) => ({ ...prev, ...patch })),
    [],
  );
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const frames = useRef<Record<string, number | null>>({});

  useEffect(() => {
    const cycle = setInterval(
      () => set((p) => (p.auto ? { ...p, open: !p.open, scanN: p.scanN + 1 } : p)),
      4200,
    );
    const sdk = setInterval(
      () => set((p) => (p.sdkAuto ? { ...p, sdk: (p.sdk + 1) % PRIMITIVES.length } : p)),
      7000,
    );
    const order = GROUPS.map((g) => g.id);
    const highlight = setInterval(
      () =>
        set((p) =>
          p.highlightAuto
            ? {
                ...p,
                highlight: order[(order.indexOf(p.highlight) + 1) % order.length] ?? "public",
              }
            : p,
        ),
      3200,
    );
    const step = setInterval(
      () => set((p) => (p.stepAuto ? { ...p, step: (p.step + 1) % STEPS.length } : p)),
      5000,
    );
    const pending = timers.current;
    const raf = frames.current;
    return () => {
      clearInterval(cycle);
      clearInterval(sdk);
      clearInterval(highlight);
      clearInterval(step);
      pending.forEach((t) => clearTimeout(t));
      Object.values(raf).forEach((id) => {
        if (id) cancelAnimationFrame(id);
      });
    };
  }, []);

  const track = useCallback(
    (
      key: string,
      event: MouseEvent<HTMLElement>,
      fn: (x: number, y: number, w: number, h: number) => Partial<typeof s>,
    ) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      if (frames.current[key]) return;
      frames.current[key] = requestAnimationFrame(() => {
        frames.current[key] = null;
        update(fn(x, y, rect.width, rect.height));
      });
    },
    [update],
  );

  return useMemo(() => {
    const open = OPEN_BY[s.role] ?? [];
    const readable = (id: string) => (open.includes(id) ? "open" : "sealed");
    const active = ROLES.find((r) => r.id === s.role) ?? ROLES[0];
    const threshold = THRESHOLDS[s.threshold] ?? DEFAULT_THRESHOLD;
    const proven = SAMPLE_BALANCE >= threshold.value;
    const running = s.proof === "run";
    const done = s.proof === "done";
    const pct = ((threshold.value / SCALE_MAX) * 100).toFixed(2);
    const faq = (i: number) => ({
      open: i === s.faqOpen,
      cls:
        "fq8" +
        (i === s.faqOpen ? " open" : "") +
        (s.faqCategory !== "All" && FAQ_CATEGORY[i] !== s.faqCategory ? " hide" : ""),
      pick: () => update({ faqOpen: s.faqOpen === i ? -1 : i }),
    });
    return {
      groups: GROUPS.map((g) => ({
        tag: g.tag,
        title: g.title,
        desc: g.desc,
        on: g.id === s.highlight,
        cls: g.id === s.highlight ? "lg on" : "lg",
        tagCls: "rt " + g.id,
        pick: () => {
          if (s.highlight !== g.id || s.highlightAuto)
            update({ highlight: g.id, highlightAuto: false });
        },
      })),
      rcptCls: "rcpt hl-" + s.highlight,
      prims: PRIMITIVES.map((p, i) => ({
        idx: "0" + (i + 1),
        title: p[0],
        desc: p[1],
        file: p[2],
        on: i === s.sdk,
        cls: "prim" + (i === s.sdk ? " on" : "") + (s.sdkAuto ? " auto" : ""),
        tabCls: i === s.sdk ? "itab on" : "itab",
        pick: () => update({ sdk: i, sdkAuto: false }),
      })),
      sdk0: s.sdk === 0,
      sdk1: s.sdk === 1,
      sdk2: s.sdk === 2,
      sdkLang: "TypeScript",
      fcats: FAQ_CATEGORIES.map((c) => ({
        label: c,
        count: c === "All" ? FAQ_CATEGORY.length : FAQ_CATEGORY.filter((x) => x === c).length,
        on: c === s.faqCategory,
        cls: c === s.faqCategory ? "fb8 on" : "fb8",
        pick: () => update({ faqCategory: c, faqOpen: c === "All" ? 0 : FAQ_CATEGORY.indexOf(c) }),
      })),
      fq0: faq(0),
      fq1: faq(1),
      fq2: faq(2),
      fq3: faq(3),
      fq4: faq(4),
      fq5: faq(5),
      scanCls: s.scanN < 0 ? "kscan" : "kscan g" + (s.scanN % 2),
      vcCls: "vc rv who-" + s.role,
      tiltT: `rotateX(${(-s.ty * 4).toFixed(2)}deg) rotateY(${(s.tx * 5).toFixed(2)}deg)`,
      onTilt: (e: MouseEvent<HTMLElement>) =>
        track("t", e, (x, y, w, h) => ({ tx: x / w - 0.5, ty: y / h - 0.5 })),
      onTiltEnd: () => update({ tx: 0, ty: 0 }),
      heroSeal: s.open ? "open" : "sealed",
      ksPub: s.open ? "ks" : "ks on",
      ksAcc: s.open ? "ks on" : "ks",
      ksPubOn: !s.open,
      ksAccOn: s.open,
      showSealed: () =>
        update(s.open ? { open: false, auto: false, scanN: s.scanN + 1 } : { auto: false }),
      showOpen: () =>
        update(!s.open ? { open: true, auto: false, scanN: s.scanN + 1 } : { auto: false }),
      // The hero is visibly an illustration with sample data.
      heroCap: s.open
        ? "Sample data. Accountant view: every amount decrypted with a viewing key."
        : "Sample data. Public view: anyone can verify the payments, nobody can read the amounts.",
      fx: Math.round(s.fx),
      fy: Math.round(s.fy),
      wmCls: s.footManual ? "wmk man" : "wmk auto",
      onFootMove: (e: MouseEvent<HTMLElement>) =>
        track("f", e, (x, y) => ({ fx: x, fy: y, footManual: true })),
      onFootLeave: () => update({ footManual: false }),
      split: s.split,
      onSplit: (e: ChangeEvent<HTMLInputElement>) => update({ split: Number(e.target.value) }),
      roles: ROLES.map((r) => ({
        label: r.label,
        avCls: r.avatar,
        cls: r.id === s.role ? "tb on" : "tb",
        pressed: r.id === s.role,
        pick: () => update({ role: r.id }),
      })),
      roleNote: active.note,
      isTeam: s.role === "team",
      visText: `${open.length} of 6 amounts readable`,
      vMaya: readable("maya"),
      vIdris: readable("idris"),
      vSupplier: readable("supplier"),
      vPayout: readable("payout"),
      vTreasury: readable("treasury"),
      vProof: readable("proof"),
      steps: STEPS.map((d, i) => ({
        n: "0" + (i + 1),
        title: d.title,
        desc: d.desc,
        on: i === s.step,
        cls: "sb" + (i === s.step ? " on" : "") + (s.stepAuto ? " auto" : ""),
        pick: () => update({ step: i, stepAuto: false }),
      })),
      step0: s.step === 0,
      step1: s.step === 1,
      step2: s.step === 2,
      ths: THRESHOLDS.map((t, i) => ({
        label: t.label,
        on: i === s.threshold,
        cls: i === s.threshold ? "op on" : "op",
        pick: () => update({ threshold: i, proof: "idle" }),
      })),
      tgs: TARGETS.map((t, i) => ({
        label: t,
        on: i === s.target,
        cls: i === s.target ? "op on" : "op",
        pick: () => update({ target: i, proof: "idle" }),
      })),
      running,
      done,
      certEmpty: !done,
      proveLabel: running ? "Proving" : done ? "Generate again" : "Generate proof",
      generateProof: () => {
        if (s.proof === "run") return;
        update({ proof: "run" });
        timers.current.push(setTimeout(() => update({ proof: "done" }), 2300));
      },
      scaleCls: running ? "scale run" : "scale",
      // The statement reads "Balance is at least $X".
      thPct: pct,
      thLabel: "Statement: at least " + threshold.label,
      thF: threshold.full,
      zoneCls: proven ? "zone" : "zone no",
      zoneL: proven ? pct : "0",
      zoneW: proven ? (100 - Number(pct)).toFixed(2) : pct,
      zoneText: proven ? "Your balance is somewhere in here" : "Your balance is below the line",
      spinCls: running ? "spin run" : done ? "spin ok" : "spin",
      // A proof of funds takes several transactions, so no "one transaction".
      capText: running
        ? "Proving against your sealed balance"
        : done
          ? "Checked onchain by the Sotto program"
          : "Waiting for a statement",
      stampCls: proven ? "stamp yes" : "stamp no",
      stampPath: proven ? "M5 12l5 5 9-10" : "M7 7l10 10M17 7L7 17",
      resCls: proven ? "yes" : "",
      resText: proofWords(proven).result,
      resSub: proofWords(proven).sub,
      stmtText: "Balance is at least " + threshold.full,
      tgText: TARGETS[s.target] ?? TARGETS[0],
    };
  }, [s, track, update]);
}

export type LandingView = ReturnType<typeof useLanding>;
