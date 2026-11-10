export type DbusAddressResult = { paths: string[] } | { reason: string };

export function parseDbusAddress(addresses: string | undefined): DbusAddressResult {
  if (addresses === undefined || addresses.trim() === "") return { paths: [] };
  const paths: string[] = [];
  for (const address of addresses.split(";")) {
    const colon = address.indexOf(":");
    const transport = colon < 0 ? address : address.slice(0, colon);
    const fields = colon < 0 ? [] : address.slice(colon + 1).split(",");
    if (transport !== "unix") return { reason: `unsupported D-Bus transport: ${transport || "unknown"}` };
    const pathField = fields.find((field) => field.startsWith("path="));
    if (pathField === undefined) {
      const key = fields[0]?.split("=", 1)[0] || "missing";
      return { reason: `unsupported D-Bus key: ${key}` };
    }
    try {
      paths.push(decodeURIComponent(pathField.slice("path=".length)));
    } catch {
      return { reason: "invalid D-Bus path escape" };
    }
  }
  return { paths };
}
