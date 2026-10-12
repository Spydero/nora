const HONORIFIC = /^(dr|mr|mrs|ms|mx|prof)\.?$/i;

export function nameParts(displayName: string): string[] {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  const named = parts.filter((part) => !HONORIFIC.test(part));
  return named.length > 0 ? named : parts;
}

export function firstName(displayName: string): string | undefined {
  return nameParts(displayName)[0];
}

export function initials(displayName: string): string {
  const parts = nameParts(displayName);
  const picked = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : parts;
  return picked
    .map((part) => part?.[0] ?? "")
    .join("")
    .toUpperCase();
}
