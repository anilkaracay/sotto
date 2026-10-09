// /demo/<role> (step 4.6, D-32): the demo company as its owner, its accountant, an employee or an
// outsider reads it. Public, read only, devnet only; an unknown role is a 404.
import { notFound } from "next/navigation";
import { isDemoRole } from "../../../lib/demo.ts";
import { DemoPage } from "../_components/demo-page.tsx";
import {
  AccountantScreen,
  EmployeeScreen,
  OutsiderScreen,
  OwnerScreen,
} from "../_components/demo-views.tsx";

export const dynamic = "force-dynamic";

const SCREENS = {
  owner: OwnerScreen,
  accountant: AccountantScreen,
  employee: EmployeeScreen,
  outsider: OutsiderScreen,
};

export default async function DemoRolePage({ params }: { params: Promise<{ role: string }> }) {
  const { role } = await params;
  if (!isDemoRole(role)) notFound();
  const Screen = SCREENS[role];
  return <DemoPage current={role}>{() => <Screen />}</DemoPage>;
}
