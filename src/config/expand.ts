const LEADING_TILDE = /^~(?:\/|$)/;
const VARIABLE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g;

export function expandPath(value: string, env: NodeJS.ProcessEnv, homedir: string): string {
  const tilde = LEADING_TILDE.exec(value);
  const head = tilde ? homedir + tilde[0].slice(1) : "";
  const rest = tilde ? value.slice(tilde[0].length) : value;
  return head + rest.replace(VARIABLE, (_match, braced?: string, bare?: string) => {
    const name = braced ?? bare ?? "";
    const found = env[name];
    if (found === undefined || found === "") {
      throw new Error(`references undefined environment variable $${name}`);
    }
    return found;
  });
}
