import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const appRoot = process.cwd();
const themeCss = readFileSync(
  join(appRoot, 'src/styles/theme.css'),
  'utf8'
);
const componentCss = readFileSync(
  join(appRoot, 'src/styles.css'),
  'utf8'
);
const mainSource = readFileSync(
  join(appRoot, 'src/main.tsx'),
  'utf8'
);
const responsiveE2e = readFileSync(
  join(appRoot, 'e2e/practice-flow.spec.ts'),
  'utf8'
);

const requiredTokens: Record<string, string> = {
  '--color-brand-header': '#0f7478',
  '--color-brand-action': '#168d94',
  '--color-brand-accent': '#19cdb5',
  '--color-canvas': '#ffffff',
  '--color-surface': '#f7f9f9',
  '--color-surface-muted': '#eef2f2',
  '--color-surface-elevated': '#ffffff',
  '--color-text-primary': '#192328',
  '--color-text-secondary': '#5d686e',
  '--color-text-on-brand': '#ffffff',
  '--color-border': '#d5dddd',
  '--color-border-strong': '#aebbbc',
  '--color-current': '#d99a00',
  '--color-answered': '#0f7478',
  '--color-skipped': '#66747a',
  '--color-uncertain': '#a45c00',
  '--color-overtime': '#b42318',
  '--color-danger': '#b42318',
  '--color-focus-ring': '#08747a'
};

describe('R007.2 TOEFL Reference Light Theme contract', () => {
  it('loads the centralized semantic token layer before component styles', () => {
    expect(mainSource).toContain("import './styles/theme.css';");
    expect(mainSource.indexOf("import './styles/theme.css';"))
      .toBeLessThan(mainSource.indexOf("import './styles.css';"));
    expect(themeCss).toContain('--theme-name: "TOEFL Reference Light Theme";');

    for (const [name, value] of Object.entries(requiredTokens)) {
      expect(readToken(name)).toBe(value);
    }
  });

  it('keeps raw colors and the retired dark palette out of component CSS', () => {
    expect(componentCss).not.toMatch(/#[\da-f]{3,8}\b|rgba?\(/i);
    for (const retired of ['#0f172a', '#111827', '#111c32', '#0f1a2e', '#1e293b', '#2563eb']) {
      expect(`${themeCss}\n${componentCss}`.toLowerCase()).not.toContain(retired);
    }
  });

  it('styles every major surface and interaction through semantic tokens', () => {
    for (const selector of [
      ':root',
      'body',
      '.home-header',
      '.home-nav',
      '.top-bar',
      '.bottom-bar',
      '.card',
      '.record-card',
      '.recovery-card',
      '.choice.selected',
      '.writing-input',
      '.pause-overlay',
      '.session-notice-dialog',
      '.window-close-dialog',
      '.session-summary'
    ]) {
      expect(componentCss).toContain(selector);
    }
    expect(componentCss).toMatch(/:focus-visible[\s\S]*var\(--color-focus-ring\)/);
    expect(componentCss).toMatch(/:disabled[\s\S]*var\(--color-surface-muted\)/);
  });

  it('preserves text-backed semantic states with dedicated status classes', () => {
    const statusTokens: Record<string, string> = {
      current: '--color-current',
      answered: '--color-answered',
      skipped: '--color-skipped',
      uncertain: '--color-uncertain',
      overtime: '--color-overtime'
    };
    for (const [status, token] of Object.entries(statusTokens)) {
      expect(componentCss).toContain(`.answer-card-cell.${status}`);
      expect(componentCss).toContain(`var(${token})`);
    }
  });

  it('keeps the required responsive overflow checks and bounded layouts', () => {
    for (const width of [560, 720, 900]) {
      expect(responsiveE2e).toContain(String(width));
    }
    expect(responsiveE2e).toContain('expectNoHorizontalOverflow');
    expect(componentCss).toContain('minmax(0, 1fr)');
    expect(componentCss).toMatch(/@media\s*\(max-width:\s*760px\)/);
    expect(componentCss).toContain('max-width: 100%');
  });

  it('meets AA contrast for core text, brand chrome and focus indicators', () => {
    expect(contrast(readToken('--color-text-primary'), readToken('--color-canvas'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(readToken('--color-text-secondary'), readToken('--color-canvas'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(readToken('--color-text-on-brand'), readToken('--color-brand-header'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(readToken('--color-focus-ring'), readToken('--color-canvas'))).toBeGreaterThanOrEqual(3);
  });
});

function readToken(name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = themeCss.match(new RegExp(`${escaped}\\s*:\\s*([^;]+);`));
  if (!match) throw new Error(`Missing theme token: ${name}`);
  return match[1].trim().toLowerCase();
}

function contrast(first: string, second: string): number {
  const lighter = Math.max(luminance(first), luminance(second));
  const darker = Math.min(luminance(first), luminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

function luminance(hex: string): number {
  const channels = hex.slice(1).match(/.{2}/g);
  if (!channels || channels.length !== 3) throw new Error(`Expected six-digit hex color, received ${hex}`);
  const [red, green, blue] = channels.map((channel) => {
    const normalized = Number.parseInt(channel, 16) / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}
