import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';

/** The shape every full-page message uses: not found, forbidden, unexpected failure. */
export function Centered({ title, body, action }: { title: string; body: string; action: string }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-muted-foreground">{body}</p>
      <Button asChild>
        <Link to="/">{action}</Link>
      </Button>
    </main>
  );
}
