import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface DbusAddressResult {
  paths?: string[];
  reason?: string;
}

async function parseDbusAddress(address: string | undefined): Promise<DbusAddressResult> {
  const path = resolve(process.cwd(), "src/assistant/pi/dbus-address.js");
  const module = (await import(path)) as {
    parseDbusAddress(address: string | undefined): DbusAddressResult;
  };
  return module.parseDbusAddress(address);
}

describe("parseDbusAddress", () => {
  it.each([undefined, "", "   "])("returns no paths for %s", async (address) => {
    await expect(parseDbusAddress(address)).resolves.toEqual({ paths: [] });
  });

  it("decodes a Unix path", async () => {
    await expect(parseDbusAddress("unix:path=/tmp/a%20b")).resolves.toEqual({ paths: ["/tmp/a b"] });
  });

  it("keeps multiple Unix paths in order", async () => {
    await expect(parseDbusAddress("unix:path=/tmp/first;unix:path=/tmp/second")).resolves.toEqual({
      paths: ["/tmp/first", "/tmp/second"],
    });
  });

  it.each([
    ["tcp:host=secret", "unsupported D-Bus transport: tcp"],
    ["unix:abstract=secret", "unsupported D-Bus key: abstract"],
    ["unix:path=/tmp/%Q0", "invalid D-Bus path escape"],
  ])("returns a safe reason for %s", async (address, reason) => {
    const result = await parseDbusAddress(address);
    expect(result).toEqual({ reason });
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});
