import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { TestApp } from '@/test/TestApp';
import { ChatContent } from './ChatContent';

// A valid npub with no published kind-0 → genUserName resolves it to
// "Swift Falcon" deterministically (same fixture NoteContent.test uses).
const NPUB = 'npub1zg69v7ys40x77y352eufp27daufrg4ncjz4ummcjx3t83y9tehhsqepuh0';

describe('ChatContent', () => {
  it('renders a nostr:npub mention as an @name link, not a raw key', async () => {
    render(
      <TestApp>
        <ChatContent content={`hey nostr:${NPUB} welcome!`} />
      </TestApp>,
    );

    const mention = await screen.findByRole('link');
    expect(mention.textContent).toEqual('@Swift Falcon');
    // The raw npub must NOT leak into the rendered text.
    expect(mention.textContent).not.toMatch(/^@npub1/);
    expect(mention).toHaveClass('text-muted-foreground');
  });

  it('resolves a bare (no nostr: prefix) npub mention', async () => {
    render(
      <TestApp>
        <ChatContent content={`cc @${NPUB}`} />
      </TestApp>,
    );

    const mention = await screen.findByRole('link');
    expect(mention.textContent).toEqual('@Swift Falcon');
  });

  it('resolves an nprofile mention to the same name', async () => {
    // nprofile for the same pubkey as NPUB (no relays).
    const nprofile =
      'nprofile1qqspydzk0zg2hn00zg69v7ys40x77y352eufp27daufrg4ncjz4ummct58nn9';
    render(
      <TestApp>
        <ChatContent content={`thanks nostr:${nprofile}`} />
      </TestApp>,
    );
    const mention = await screen.findByRole('link');
    expect(mention.textContent).toEqual('@Swift Falcon');
  });

  it('linkifies URLs inline (no preview card)', async () => {
    render(
      <TestApp>
        <ChatContent content="see https://example.com for details" />
      </TestApp>,
    );
    const link = await screen.findByRole('link', { name: 'https://example.com' });
    expect(link).toHaveAttribute('href', 'https://example.com');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('renders hashtags as in-app links', async () => {
    render(
      <TestApp>
        <ChatContent content="gm #nostr" />
      </TestApp>,
    );
    const tag = await screen.findByRole('link', { name: '#nostr' });
    expect(tag).toHaveAttribute('href', '/t/nostr');
  });

  it('leaves plain text untouched with no links', async () => {
    render(
      <TestApp>
        <ChatContent content="just a normal message" />
      </TestApp>,
    );
    expect(await screen.findByText('just a normal message')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('renders an attached image (described by imeta) inline, not as a link', async () => {
    const url = 'https://blossom.example/abc123.png';
    const { container } = render(
      <TestApp>
        <ChatContent content={`here it is\n${url}`} tags={[['imeta', `url ${url}`, 'm image/png']]} />
      </TestApp>,
    );
    // The screenshot renders as an <img>; the raw URL is not shown as a link.
    await waitFor(() => expect(container.querySelector('img')).toBeInTheDocument());
    expect(screen.queryByRole('link', { name: url })).not.toBeInTheDocument();
    // The caption text is still shown above the image.
    expect(screen.getByText('here it is')).toBeInTheDocument();
  });

  it('keeps a pasted image URL (no imeta) as a plain link', async () => {
    const url = 'https://example.com/pic.png';
    render(
      <TestApp>
        <ChatContent content={`look ${url}`} />
      </TestApp>,
    );
    const link = await screen.findByRole('link', { name: url });
    expect(link).toHaveAttribute('href', url);
  });
});
