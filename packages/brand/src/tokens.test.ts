import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { contrastRatio } from './contrast.ts';
import { color, radius, requiredContrastPairs, typography } from './tokens.ts';

const css = readFileSync(new URL('./theme.css', import.meta.url), 'utf8');

function cssVar(name: string): string {
  const match = new RegExp(`--${name}:\\s*([^;]+);`).exec(css);
  assert.ok(match, `theme.css is missing --${name}`);
  return match[1].trim();
}

describe('contrast', () => {
  it('matches known WCAG reference values', () => {
    assert.equal(contrastRatio('#000000', '#FFFFFF').toFixed(1), '21.0');
    assert.equal(contrastRatio('#FFFFFF', '#FFFFFF').toFixed(1), '1.0');
  });

  for (const pair of requiredContrastPairs) {
    it(`${pair.name} meets ${pair.min}:1`, () => {
      const ratio = contrastRatio(pair.fg, pair.bg);
      assert.ok(ratio >= pair.min, `${pair.fg} on ${pair.bg} is ${ratio.toFixed(2)}:1`);
    });
  }
});

describe('theme.css matches tokens.ts', () => {
  const colorVars: Record<string, string> = {
    'color-brand-navy': color.brand.navy,
    'color-brand-teal': color.brand.teal,
    'color-brand-teal-hover': color.brand.tealHover,
    'color-brand-cyan': color.brand.cyan,
    'color-fg': color.text.primary,
    'color-fg-muted': color.text.secondary,
    'color-fg-inverse': color.text.inverse,
    'color-canvas': color.surface.page,
    'color-panel': color.surface.panel,
    'color-subtle': color.surface.subtle,
    'color-line': color.border.default,
    'color-line-strong': color.border.strong,
    'color-focus': color.focus.ring,
    'color-success': color.status.success,
    'color-success-bg': color.status.successBg,
    'color-warning': color.status.warning,
    'color-warning-bg': color.status.warningBg,
    'color-danger': color.status.danger,
    'color-danger-bg': color.status.dangerBg,
    'color-info': color.status.info,
    'color-info-bg': color.status.infoBg,
  };

  for (const [name, value] of Object.entries(colorVars)) {
    it(`--${name}`, () => assert.equal(cssVar(name).toUpperCase(), value.toUpperCase()));
  }

  it('type scale', () => {
    const map = {
      'page-title': typography.scale.pageTitle,
      'panel-title': typography.scale.panelTitle,
      'card-title': typography.scale.cardTitle,
      body: typography.scale.body,
      secondary: typography.scale.secondary,
      meta: typography.scale.metadata,
    };
    for (const [name, step] of Object.entries(map)) {
      assert.equal(cssVar(`text-${name}`), `${step.size}px`);
      assert.equal(cssVar(`text-${name}--line-height`), `${step.lineHeight}px`);
    }
  });

  it('radii', () => {
    assert.equal(cssVar('radius-control'), `${radius.control}px`);
    assert.equal(cssVar('radius-card'), `${radius.card}px`);
    assert.equal(cssVar('radius-panel'), `${radius.panel}px`);
  });
});
