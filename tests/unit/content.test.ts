// Guards for the spec's hard rules. These run on every push.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { skillGroups, knownIds, proofLink, site } from '../../src/lib/content';

const contentDir = join(__dirname, '../../src/content');
const allContent = readdirSync(contentDir)
  .filter((f) => f.endsWith('.json'))
  // Drop editor-only "$comment" keys; they describe the rules themselves.
  .map((f) => JSON.stringify(JSON.parse(readFileSync(join(contentDir, f), 'utf8')), (k, v) => (k === '$comment' ? undefined : v)))
  .join('\n');

describe('hard rules', () => {
  it('never contains a phone number', () => {
    // Indian mobile numbers: optional +91 / 0, then 10 digits starting 6-9.
    expect(allContent).not.toMatch(/(\+91[\s-]?|\b0)?[6-9]\d{9}\b/);
    expect(allContent.toLowerCase()).not.toMatch(/"phone"|"mobile"|tel:/);
  });

  it('never mentions CGPA or placements', () => {
    expect(allContent).not.toMatch(/cgpa|gpa\b|placement/i);
  });

  it('has no leftover TODOs', () => {
    expect(allContent).not.toMatch(/TODO/);
  });

  it('uses the owner-chosen public email', () => {
    expect(site.contact.email).toBe('asadullah.faisal@proton.me');
    expect(allContent).not.toContain('b23cm1008');
  });
});

describe('skills', () => {
  it('every skill links to at least one proof that resolves', () => {
    for (const g of skillGroups) {
      for (const s of g.skills) {
        expect(s.proof.length, s.name).toBeGreaterThan(0);
        for (const p of s.proof) {
          if (!p.startsWith('http')) expect(knownIds.has(p), `${s.name} → ${p}`).toBe(true);
          expect(() => proofLink(p, s.proofLabel)).not.toThrow();
        }
      }
    }
  });
});
