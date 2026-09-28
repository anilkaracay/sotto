// D-10: the devnet and localnet screening deny list, until the founder chooses a provider. Test data
// only: the addresses come from public seed texts (tests/e2e/fixtures.ts seededKeypair), so their
// keys are known and they never hold funds. Mainnet never uses this list.
export const DENYLIST: readonly { address: string; note: string }[] = [
  {
    address: "9RvS4RFZgfX4qytz5L4mYrKZW9M3crnHLKc6fBkhpf9B",
    note: "seed text sotto-e2e-denied/v1 (browser tests)",
  },
  {
    address: "3is1rfSs3j8ethSn2WVnZAPufEuUFMEe3ay8hgRoQWqK",
    note: "seed text sotto-api-denied/v1 (API tests)",
  },
];
