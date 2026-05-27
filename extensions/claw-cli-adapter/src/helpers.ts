// ----------------------------------------------------------------
// <copyright company="Microsoft Corporation">
// Copyright (c) Microsoft Corporation.  All rights reserved.
// </copyright>
// ----------------------------------------------------------------

export function secondsToMs(seconds: number): number {
  return seconds * 1000;
}

export function truncateAtCharBoundary(str: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  const encoded = encoder.encode(str);
  if (encoded.length <= maxBytes) return str;

  let byteCount = 0;
  let charIndex = 0;
  for (const char of str) {
    const charBytes = encoder.encode(char).length;
    if (byteCount + charBytes > maxBytes) break;
    byteCount += charBytes;
    charIndex += char.length;
  }
  return str.slice(0, charIndex);
}
