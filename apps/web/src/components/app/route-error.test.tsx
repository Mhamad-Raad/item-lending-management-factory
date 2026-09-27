// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import type { ErrorComponentProps } from '@tanstack/react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import type * as ChunkReload from '@/lib/chunk-reload';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...props }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));
const reloadOnce = vi.fn(() => false);
vi.mock('@/lib/chunk-reload', async (original) => ({
  ...(await original<typeof ChunkReload>()),
  reloadOnceForNewVersion: () => reloadOnce(),
}));

const { RouteError } = await import('./route-error');
const { ForbiddenError } = await import('@/lib/route-guards');

const props = (error: unknown): ErrorComponentProps => ({ error, reset: () => undefined }) as ErrorComponentProps;

describe('RouteError (Q81)', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  afterEach(() => {
    cleanup();
    reloadOnce.mockClear();
  });

  it('never shows the raw error text, and offers Reload and the way home', () => {
    render(<RouteError {...props(new Error('relation "orders" does not exist at line 3'))} />);

    expect(screen.getByRole('heading').textContent).toBe(i18n.t('common.pageError.title'));
    expect(document.body.textContent).not.toContain('relation');
    expect(screen.getByRole('button', { name: i18n.t('common.actions.reload') })).toBeTruthy();
    expect(screen.getByRole('link', { name: i18n.t('common.notFound.backHome') })).toBeTruthy();
    expect(reloadOnce).not.toHaveBeenCalled();
  });

  it('says a new version is out and reloads once when a chunk failed to load', () => {
    render(<RouteError {...props(new TypeError('Failed to fetch dynamically imported module: /assets/x.js'))} />);

    expect(screen.getByRole('heading').textContent).toBe(i18n.t('common.pageError.staleTitle'));
    expect(reloadOnce).toHaveBeenCalledTimes(1);
  });

  it('shows the forbidden page for a missing permission', () => {
    render(<RouteError {...props(new ForbiddenError())} />);

    expect(screen.getByRole('heading').textContent).toBe(i18n.t('common.forbidden.title'));
  });
});
