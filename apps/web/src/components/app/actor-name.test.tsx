// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { actorLabel } from '@/lib/actor-label';
import { ActorName } from './actor-name';

const USER = { displayName: 'ئەحمەد', username: 'ahmad.k' };

/** Q121: a display name is never shown without the username that no one else can take. */
describe('ActorName', () => {
  afterEach(cleanup);

  it('shows the display name followed by the @username, left to right', () => {
    const { container } = render(<ActorName user={USER} />);
    const parts = container.querySelectorAll('bdi');
    expect([...parts].map((part) => part.textContent)).toEqual(['ئەحمەد', '@ahmad.k']);
    expect(parts[1]?.getAttribute('dir')).toBe('ltr');
  });

  it('isolates both parts in the plain-text form', () => {
    expect(actorLabel(USER)).toBe('⁨ئەحمەد⁩ ⁨@ahmad.k⁩');
  });
});
