"use client";

// Devnet's quick start (step 4.6, D-33): a wallet that signed in and belongs to no organization
// gets one made for it, "My company", verified at once, and goes to its dashboard. No form. The
// request is a POST of its own, sent once when this screen opens; a failure is said, with the way
// to try again.
import { Button, Card, PageHeader } from "@sotto/ui";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ApiCallError, callApi } from "../../../lib/client/api.ts";
import cards from "./confidential/cards.module.css";

export function QuickStart() {
  const router = useRouter();
  const started = useRef(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        const { org } = await callApi<{ org: { id: string } }>("/api/orgs/quick-start", {
          method: "POST",
          body: {},
        });
        router.replace(`/app/${org.id}/overview`);
      } catch (error) {
        setProblem(
          error instanceof ApiCallError ? error.message : "Sotto could not be reached. Try again.",
        );
      }
    })();
  }, [router, attempt]);

  return (
    <>
      <PageHeader overline="Quick start" title="Setting up your company" />
      <Card data-testid="quick-start">
        {problem ? (
          <>
            <p className={cards.problem} role="alert">
              {problem}
            </p>
            <div className={cards.actions}>
              <Button
                variant="line"
                onClick={() => {
                  started.current = false;
                  setProblem(null);
                  setAttempt((value) => value + 1);
                }}
              >
                Try again
              </Button>
            </div>
          </>
        ) : (
          <p className={cards.lead} role="status">
            Creating &quot;My company&quot; on devnet for your wallet. You can change its name and
            details later.
          </p>
        )}
      </Card>
    </>
  );
}
