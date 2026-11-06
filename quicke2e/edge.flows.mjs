// Boundary and attack cases on the create form. Run only after happy.spec.mjs is green.
const s = process.env.QE_STAMP ?? "zz";
const base = {
  start: "/settings/developers",
  storageState: "auth.json",
  redact: ['[data-testid="new-key-value"]', /tb_\w{10,}/],
  maxSteps: 8,
  neverClick: ["Revoke*", "Rotate*"],
};
const banner = (name) => `Copy “${name}” now — it will not be shown again.`;
const longest = `Boundary name ${s} `.padEnd(32, "x"); // the input's maxLength is 32
const html = "<img src=x onerror=alert(1)>";
const sql = "Bob'); DROP TABLE apikey;--";

export default [
  {
    ...base,
    name: "boundary-name-at-max-length",
    inputs: { "key name": longest },
    goal: `Type "${longest}" into Key name, then click Create key`,
    expect: [banner(longest)],
  },
  {
    ...base,
    name: "attack-html-in-key-name-is-plain-text",
    kind: "attack",
    inputs: { "key name": html },
    goal: `Type "${html}" into Key name, then click Create key`,
    expect: [banner(html)],
  },
  {
    ...base,
    name: "attack-sql-in-key-name-is-plain-text",
    kind: "attack",
    inputs: { "key name": sql },
    goal: `Type "${sql}" into Key name, then click Create key`,
    expect: [banner(sql)],
  },
  {
    name: "attack-signed-out-is-sent-to-sign-in",
    kind: "attack",
    start: "/settings/developers",
    control: "/",
    goal: "Open the API keys page",
    expectUrl: "/sign-in",
  },
];
