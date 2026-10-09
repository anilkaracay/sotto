// /demo/compare (step 4.6, D-32): one payment of the demo company as each of the four roles' own
// views hold it, side by side. Public, read only, devnet only.
import { DemoPage } from "../_components/demo-page.tsx";
import { CompareScreen } from "../_components/demo-views.tsx";

export const dynamic = "force-dynamic";

export default function DemoComparePage() {
  return <DemoPage current="compare">{() => <CompareScreen />}</DemoPage>;
}
