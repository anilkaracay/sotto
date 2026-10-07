// Approval policy (D-04). The hackathon build keeps every organization at the default of
// 1 approval: the initiator's execution is the approval, recorded with the execution signature.
// Policies of 2 or more need the approver screen, which is Post-hackathon (D-27), so the API
// refuses them. The approval message API and its tests still cover policies of 2 or more.
import { z } from "zod";
import { ApiError } from "./errors.ts";

/** Highest approval count an organization can set in the hackathon build. */
export const MAX_APPROVALS_REQUIRED = 1;

export const approvalPolicySchema = z
  .object({
    paymentApprovalsRequired: z.number().int().min(1),
    payrollApprovalsRequired: z.number().int().min(1),
  })
  .strict();

export type ApprovalPolicy = z.infer<typeof approvalPolicySchema>;

export function policyNotAvailable(): ApiError {
  return new ApiError(
    422,
    "approval_policy_not_available",
    "Approval policies above 1 are not available in this build",
  );
}

export function assertPolicyAvailable(policy: ApprovalPolicy): void {
  if (
    policy.paymentApprovalsRequired > MAX_APPROVALS_REQUIRED ||
    policy.payrollApprovalsRequired > MAX_APPROVALS_REQUIRED
  ) {
    throw policyNotAvailable();
  }
}
