/** Conservative structured-original checks. Unrecognized prose is never an equality proof. */
export function sourceIdentifier(
  text: string,
  label: string,
): { namespace: string; value: string } | undefined {
  const match = text
    .trim()
    .match(/^“([^”]+)”的(service-id|repository-url)为“([^”]+)”。$/u);
  if (!match || match[1] !== label) return undefined;
  if (match[2] === "repository-url") {
    try {
      const url = new URL(match[3]!);
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        return undefined;
    } catch {
      return undefined;
    }
  }
  return { namespace: match[2]!, value: match[3]! };
}
export function explicitEquivalence(
  text: string,
  left: string,
  right: string,
): boolean {
  return [
    [left, right],
    [right, left],
  ].some(
    ([a, b]) =>
      text.trim() === `“${a}”与“${b}”指同一实体。` ||
      text.trim() === `"${a}" and "${b}" refer to the same entity.`,
  );
}
