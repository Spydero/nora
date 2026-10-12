import { describe, expect, it } from 'vitest';
import { median, share, suppress, suppressBreakdown } from './insights.service.js';

describe('analytics privacy helpers', () => {
  it('withholds counts of one to four but keeps zero and larger counts', () => {
    expect(suppress(0)).toBe(0);
    expect([1, 2, 3, 4].map(suppress)).toEqual([null, null, null, null]);
    expect(suppress(5)).toBe(5);
  });

  it('withholds a second cell when a lone withheld count could be recovered from the total', () => {
    expect(suppressBreakdown([5, 0, 7, 2, 6, 6])).toEqual([null, 0, 7, null, 6, 6]);
    expect(suppressBreakdown([5, 3, 7, 2])).toEqual([5, null, 7, null]);
    expect(suppressBreakdown([5, 0, 7])).toEqual([5, 0, 7]);
  });

  it('withholds percentages when the part or the remainder is small, since the rate would reveal it', () => {
    expect(share(1, 4)).toBeNull();
    expect(share(2, 26)).toBeNull();
    expect(share(12, 15)).toBeNull();
    expect(share(0, 26)).toBe(0);
    expect(share(26, 26)).toBe(100);
    expect(share(5, 20)).toBe(25);
  });

  it('computes medians for odd and even lengths', () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
});
