import type { Metadata } from "next";
import type { ReactNode } from "react";
import { color, contrastRatio, radius, requiredContrastPairs, spacing, tokensVersion, typography } from "@nora/brand";
import { Alert, Button, Card, NoraLogo, NoraMark, StatusBadge, TextField } from "@nora/ui";

export const metadata: Metadata = { title: "Brand reference" };

const swatches: { group: string; items: { name: string; value: string }[] }[] = [
  { group: "Brand", items: Object.entries(color.brand).map(([name, value]) => ({ name: `brand.${name}`, value })) },
  { group: "Text", items: Object.entries(color.text).map(([name, value]) => ({ name: `text.${name}`, value })) },
  { group: "Surface", items: Object.entries(color.surface).map(([name, value]) => ({ name: `surface.${name}`, value })) },
  { group: "Status", items: Object.entries(color.status).map(([name, value]) => ({ name: `status.${name}`, value })) },
];

export default function BrandPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-6">
        <div>
          <NoraLogo />
          <h1 className="mt-4 text-page-title font-semibold">Brand and UI reference</h1>
          <p className="text-secondary text-fg-muted">Tokens v{tokensVersion}. Proposed baseline pending brand, accessibility and clinical approval.</p>
        </div>
        <div className="flex items-center gap-4">
          <NoraMark size={24} />
          <NoraMark size={48} />
          <span className="text-brand-navy">
            <svg viewBox="0 0 48 48" width={48} height={48} aria-hidden>
              <rect x="1.5" y="1.5" width="45" height="45" rx="10.5" fill="none" stroke="currentColor" strokeWidth="3" />
              <path d="M15 33V15l18 18V15" fill="none" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </div>
      </header>

      <Section title="Colour">
        <div className="grid gap-6 md:grid-cols-2">
          {swatches.map((group) => (
            <Card key={group.group}>
              <h3 className="text-card-title font-semibold">{group.group}</h3>
              <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {group.items.map((item) => (
                  <li key={item.name}>
                    <span className="block h-12 rounded-control border border-line" style={{ backgroundColor: item.value }} />
                    <span className="mt-1 block text-meta font-medium">{item.name}</span>
                    <span className="block text-meta text-fg-muted">{item.value}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      </Section>

      <Section title="Contrast checks">
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-left text-secondary">
            <thead className="border-b border-line bg-subtle">
              <tr>
                <th scope="col" className="px-4 py-2 font-semibold">Pairing</th>
                <th scope="col" className="px-4 py-2 font-semibold">Sample</th>
                <th scope="col" className="px-4 py-2 font-semibold">Ratio</th>
                <th scope="col" className="px-4 py-2 font-semibold">Result</th>
              </tr>
            </thead>
            <tbody>
              {requiredContrastPairs.map((pair) => {
                const ratio = contrastRatio(pair.fg, pair.bg);
                const pass = ratio >= pair.min;
                return (
                  <tr key={pair.name} className="border-b border-line last:border-0">
                    <td className="px-4 py-2">{pair.name}</td>
                    <td className="px-4 py-2">
                      <span className="rounded-control px-2 py-1 font-medium" style={{ color: pair.fg, backgroundColor: pair.bg }}>
                        Aa Sample
                      </span>
                    </td>
                    <td className="px-4 py-2 tabular-nums">
                      {ratio.toFixed(2)}:1 <span className="text-fg-muted">(min {pair.min})</span>
                    </td>
                    <td className="px-4 py-2">
                      <StatusBadge status={pass ? "success" : "danger"}>{pass ? "Pass" : "Fail"}</StatusBadge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      </Section>

      <Section title="Typography">
        <Card className="flex flex-col gap-3">
          {Object.entries(typography.scale).map(([name, step]) => (
            <div key={name} className="flex flex-wrap items-baseline gap-4">
              <span className="w-28 text-meta text-fg-muted">
                {name} {step.size}/{step.lineHeight}
              </span>
              <span style={{ fontSize: step.size, lineHeight: `${step.lineHeight}px` }} className="font-semibold">
                Possible explanation based on the information provided
              </span>
            </div>
          ))}
        </Card>
      </Section>

      <Section title="Components">
        <div className="grid gap-6 md:grid-cols-2">
          <Card className="flex flex-col gap-4">
            <h3 className="text-card-title font-semibold">Buttons (44 px minimum target)</h3>
            <div className="flex flex-wrap gap-3">
              <Button>Continue</Button>
              <Button variant="secondary">Review answers</Button>
              <Button variant="ghost">Cancel</Button>
              <Button variant="danger">Remove report</Button>
              <Button loading>Saving</Button>
            </div>
            <h3 className="text-card-title font-semibold">Status (colour + icon + label)</h3>
            <div className="flex flex-wrap gap-2">
              <StatusBadge status="success">Booked</StatusBadge>
              <StatusBadge status="warning">Pending confirmation</StatusBadge>
              <StatusBadge status="danger">Urgent</StatusBadge>
              <StatusBadge status="info">Clinician reviewed</StatusBadge>
            </div>
          </Card>
          <Card className="flex flex-col gap-4">
            <TextField label="Email" placeholder="you@example.com" hint="We use this to sign you in." />
            <TextField label="Password" type="password" error="Use at least 12 characters" />
          </Card>
          <div className="flex flex-col gap-3 md:col-span-2">
            <Alert status="danger" title="Call emergency services now">
              Based on the information provided, your symptoms need immediate care.
            </Alert>
            <Alert status="warning" title="See a doctor within 24 hours">
              Possible explanation: a bacterial throat infection. A clinician can confirm this.
            </Alert>
          </div>
        </div>
      </Section>

      <Section title="Shape and spacing">
        <Card className="flex flex-wrap items-end gap-6">
          {Object.entries(radius).map(([name, value]) => (
            <div key={name} className="text-center">
              <div className="size-16 border border-line-strong bg-subtle" style={{ borderRadius: value }} />
              <p className="mt-1 text-meta">
                {name} {value}px
              </p>
            </div>
          ))}
          <div className="flex items-end gap-2">
            {spacing.map((value) => (
              <div key={value} className="text-center">
                <div className="bg-brand-teal" style={{ width: value, height: value }} />
                <p className="mt-1 text-meta">{value}</p>
              </div>
            ))}
          </div>
        </Card>
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="mb-4 text-panel-title font-semibold">{title}</h2>
      {children}
    </section>
  );
}
