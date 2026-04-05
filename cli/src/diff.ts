export function unifiedDiff(
  existing: string,
  template: string,
  label: string,
): string {
  const a = existing.split("\n");
  const b = template.split("\n");
  const lines: string[] = [`--- existing ${label}`, `+++ template ${label}`];

  const lcs = computeLCS(a, b);
  let ai = 0;
  let bi = 0;

  for (const match of lcs) {
    while (ai < match.ai) lines.push(`\x1b[31m- ${a[ai++]}\x1b[0m`);
    while (bi < match.bi) lines.push(`\x1b[32m+ ${b[bi++]}\x1b[0m`);
    lines.push(`  ${a[ai]}`);
    ai++;
    bi++;
  }

  while (ai < a.length) lines.push(`\x1b[31m- ${a[ai++]}\x1b[0m`);
  while (bi < b.length) lines.push(`\x1b[32m+ ${b[bi++]}\x1b[0m`);

  if (lines.length > 80) {
    return lines.slice(0, 80).join("\n") + `\n... (${lines.length - 80} more lines)`;
  }

  return lines.join("\n");
}

interface Match {
  ai: number;
  bi: number;
}

function computeLCS(a: string[], b: string[]): Match[] {
  const m = a.length;
  const n = b.length;

  if (m * n > 100_000) {
    return simpleLCS(a, b);
  }

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (a[i] === b[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const matches: Match[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      matches.push({ ai: i, bi: j });
      i++;
      j++;
    } else if (dp[i + 1]?.[j] ?? 0 >= (dp[i]?.[j + 1] ?? 0)) {
      i++;
    } else {
      j++;
    }
  }

  return matches;
}

function simpleLCS(a: string[], b: string[]): Match[] {
  const matches: Match[] = [];
  let bi = 0;
  for (let ai = 0; ai < a.length && bi < b.length; ai++) {
    const idx = b.indexOf(a[ai], bi);
    if (idx !== -1) {
      matches.push({ ai, bi: idx });
      bi = idx + 1;
    }
  }
  return matches;
}
