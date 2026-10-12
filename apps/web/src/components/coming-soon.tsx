import { Card } from "@nora/ui";

export function ComingSoon({ title, description, release }: { title: string; description: string; release: string }) {
  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-page-title font-semibold">{title}</h1>
      <Card className="mt-6">
        <p className="text-body">{description}</p>
        <p className="mt-2 text-meta text-fg-muted">Planned release: {release}</p>
      </Card>
    </main>
  );
}
