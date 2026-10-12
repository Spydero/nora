export const tokensVersion = '1.0.0';

export const color = {
  brand: {
    navy: '#142B45',
    teal: '#087F8C',
    tealHover: '#066B76',
    cyan: '#16C4D5',
  },
  text: {
    primary: '#172B3A',
    secondary: '#526477',
    inverse: '#FFFFFF',
  },
  surface: {
    page: '#F5F8FA',
    panel: '#FFFFFF',
    subtle: '#EEF3F6',
  },
  border: {
    default: '#D6E0E7',
    strong: '#A9B8C4',
  },
  focus: {
    ring: '#2457C5',
  },
  status: {
    success: '#166534',
    successBg: '#ECFDF3',
    warning: '#8A4B00',
    warningBg: '#FFF7E6',
    danger: '#B42318',
    dangerBg: '#FEF3F2',
    info: '#1D4E89',
    infoBg: '#EFF6FF',
  },
} as const;

export const typography = {
  fontFamily: "'Inter Variable', Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
  scale: {
    pageTitle: { size: 28, lineHeight: 36 },
    panelTitle: { size: 18, lineHeight: 26 },
    cardTitle: { size: 16, lineHeight: 24 },
    body: { size: 16, lineHeight: 24 },
    secondary: { size: 14, lineHeight: 20 },
    metadata: { size: 12, lineHeight: 18 },
  },
  weight: { regular: 400, medium: 500, semibold: 600 },
} as const;

export const spacing = [4, 8, 12, 16, 24, 32, 48] as const;

export const radius = { control: 8, card: 12, panel: 16 } as const;

export const layout = {
  headerHeight: 64,
  gutter: 16,
  minTarget: 44,
  breakpoints: { tablet: 768, desktop: 1280 },
  desktopPanels: { intake: 28, findings: 44, suggestions: 28 },
} as const;

export const motion = { fast: 120, base: 180 } as const;

/**
 * Text/background pairings the product relies on. Each must meet its WCAG
 * contrast minimum; tenant themes are validated against the same list.
 */
export const requiredContrastPairs = [
  { name: 'body on panel', fg: color.text.primary, bg: color.surface.panel, min: 4.5 },
  { name: 'body on page', fg: color.text.primary, bg: color.surface.page, min: 4.5 },
  { name: 'secondary on panel', fg: color.text.secondary, bg: color.surface.panel, min: 4.5 },
  { name: 'secondary on page', fg: color.text.secondary, bg: color.surface.page, min: 4.5 },
  { name: 'primary button label', fg: color.text.inverse, bg: color.brand.teal, min: 4.5 },
  { name: 'primary button hover label', fg: color.text.inverse, bg: color.brand.tealHover, min: 4.5 },
  { name: 'navigation on navy', fg: color.text.inverse, bg: color.brand.navy, min: 4.5 },
  { name: 'teal link on panel', fg: color.brand.teal, bg: color.surface.panel, min: 4.5 },
  { name: 'success badge', fg: color.status.success, bg: color.status.successBg, min: 4.5 },
  { name: 'warning badge', fg: color.status.warning, bg: color.status.warningBg, min: 4.5 },
  { name: 'danger badge', fg: color.status.danger, bg: color.status.dangerBg, min: 4.5 },
  { name: 'info badge', fg: color.status.info, bg: color.status.infoBg, min: 4.5 },
  { name: 'danger on panel', fg: color.status.danger, bg: color.surface.panel, min: 4.5 },
  { name: 'focus ring on panel', fg: color.focus.ring, bg: color.surface.panel, min: 3 },
] as const;
