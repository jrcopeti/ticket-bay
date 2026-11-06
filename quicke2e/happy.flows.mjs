// The three requested cases. Order matters: each flow relies on the keys the earlier ones made.
// QE_STAMP gives every round fresh key names (letters only, so names are not treated as secrets).
const s = process.env.QE_STAMP ?? "zz";
const alpha = `Alpha agent ${s}`;
const bravo = `Bravo agent ${s}`;
const keep = `Keep agent ${s}`;
const base = {
  start: "/settings/developers",
  storageState: "auth.json",
  redact: ['[data-testid="new-key-value"]', /tb_\w{10,}/],
};
const banner = (name) => `Copy “${name}” now — it will not be shown again.`;
const create = (name, flowName) => ({
  ...base,
  name: flowName,
  maxSteps: 8,
  inputs: { "key name": name },
  goal: `Type "${name}" into Key name, then click Create key`,
  expect: [banner(name)],
  neverClick: ["Revoke*", "Rotate*"],
});

export default [
  // Case 1: create a key. "never used" only exists on a key row, so it proves the list shows it too.
  { ...create(alpha, "create-key"), expect: [banner(alpha), "never used"] },

  // Case 2: revoke it.
  {
    ...base,
    name: "revoke-key",
    maxSteps: 8,
    goal: `Click "Revoke ${alpha}", then click the Revoke button to confirm`,
    // Not expectSeen: QuickE2E 0.5.0's recorder misses this toast although it is on screen, and on a slow
    // machine it is gone before the next snapshot. e2e/api-keys.spec.ts asserts the toast.
    expectGone: [alpha],
    expect: ["No API keys yet."],
    neverClick: ["Rotate*"],
  },

  // Fixtures for case 3: one key to revoke, one that must survive.
  create(keep, "setup-keep-key"),
  create(bravo, "setup-bravo-key"),

  // Case 3a: gone from the list on the same page, and only that key.
  {
    ...base,
    name: "revoked-key-gone-from-list",
    maxSteps: 8,
    goal: `Click "Revoke ${bravo}", then click the Revoke button to confirm`,
    expectGone: [bravo],
    expect: [keep],
    neverClick: ["Rotate*", "Revoke Keep*"],
  },

  // Case 3b: still gone on a fresh server render, reached through the Settings → Developers menu.
  {
    name: "revoked-key-gone-after-navigation",
    start: "/",
    storageState: "auth.json",
    maxSteps: 8,
    goal: "Open the user menu in the header, then click Settings → Developers",
    expectUrl: "/settings/developers$",
    expect: [keep],
    expectGone: [bravo],
    neverClick: ["Revoke*", "Rotate*"],
  },
];
