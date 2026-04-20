import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, Send } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { MessageBubble } from '@/components/chat/MessageBubble';

/**
 * /parent/kid/:id/groups/:gid — group view.
 *
 * Visual only. Chat tab renders a fixed list of 3 placeholder messages
 * + a composer that appends new messages to local state (cleared on
 * navigation away). Members/About show static placeholder content.
 * A later data-layer PR swaps the static array for NIP-22 comments
 * scoped to the community's `a` tag.
 */
type Tab = 'chat' | 'members' | 'about';

interface Msg {
  id: string;
  align: 'start' | 'end';
  author?: string;
  body: string;
}

const INITIAL: Msg[] = [
  { id: 'm1', align: 'start', author: 'Ms Tanel',   body: 'Hi everyone!' },
  { id: 'm2', align: 'start', author: 'Ms Tanel',   body: 'Just shared a video in the drive — bread with grandma.' },
  { id: 'm3', align: 'end',                          body: 'Cool, can we watch it?' },
];

const MEMBERS = [
  { id: 'u1', name: 'Ms Tanel',    role: 'Teacher', bg: '#F97316' },
  { id: 'u2', name: 'Mommy Marie', role: 'Parent',  bg: '#6366F1' },
  { id: 'u3', name: 'Aunt Mallory', role: 'Parent',  bg: '#22C55E' },
  { id: 'u4', name: 'James White', role: 'Parent',  bg: '#475569' },
  { id: 'u5', name: 'Sebastian H', role: 'Parent',  bg: '#64748B' },
];

export function GroupViewPage() {
  const nav = useNavigate();
  const { id = 'ellie', gid = 'classroom-2b' } = useParams<{ id: string; gid: string }>();

  const [tab, setTab] = useState<Tab>('chat');
  const [messages, setMessages] = useState<Msg[]>(INITIAL);
  const [draft, setDraft] = useState('');

  const handleSend = () => {
    const body = draft.trim();
    if (!body) return;
    setMessages((prev) => [
      ...prev,
      { id: `m${Date.now()}`, align: 'end', body },
    ]);
    setDraft('');
  };

  return (
    <div className="flex flex-col min-h-dvh pt-2 pb-6">
      {/* Top bar */}
      <div className="flex items-center gap-2 px-4">
        <Button
          variant="ghost"
          size="icon"
          className="size-9 rounded-full"
          onClick={() => nav(`/parent/kid/${id}/trust/people`)}
          aria-label="Back"
        >
          <ChevronLeft className="size-5" />
        </Button>
        <div className="size-9 rounded-full bg-primary flex-shrink-0" aria-hidden />
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-semibold truncate">Classroom 2B</div>
          <div className="text-[11px] text-muted-foreground">{MEMBERS.length} members</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="px-4 flex items-center gap-2 mt-3" role="tablist">
        {(['chat', 'members', 'about'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn(
              'h-8 px-4 rounded-full text-[12px] font-medium capitalize transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
              tab === t
                ? 'bg-primary text-primary-foreground'
                : 'bg-card text-muted-foreground hover:text-foreground',
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Content */}
      {tab === 'chat' && (
        <>
          <div className="flex-1 flex flex-col gap-2 px-4 pt-4 pb-2 overflow-y-auto">
            {messages.map((m) => (
              <MessageBubble key={m.id} align={m.align} author={m.author}>
                {m.body}
              </MessageBubble>
            ))}
          </div>
          <form
            className="px-4 flex items-center gap-2 mt-2"
            onSubmit={(e) => { e.preventDefault(); handleSend(); }}
          >
            <Input
              placeholder="Type a message…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="h-11 rounded-full flex-1"
            />
            <Button
              type="submit"
              size="icon"
              className="size-11 rounded-full flex-shrink-0"
              disabled={!draft.trim()}
              aria-label="Send"
            >
              <Send className="size-4" />
            </Button>
          </form>
        </>
      )}

      {tab === 'members' && (
        <div className="flex-1 flex flex-col gap-2 px-4 pt-4">
          {MEMBERS.map((m) => (
            <div
              key={m.id}
              className="flex items-center gap-3 p-2.5 rounded-xl bg-card/60"
            >
              <div
                className="size-9 rounded-full flex-shrink-0"
                style={{ backgroundColor: m.bg }}
                aria-hidden
              />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold truncate">{m.name}</div>
                <div className="text-[11px] text-muted-foreground">{m.role}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'about' && (
        <div className="flex-1 flex flex-col gap-3 px-5 pt-4 text-[13px] leading-relaxed">
          <p className="text-muted-foreground">
            Classroom 2B is a private group for parents and the teacher of
            St. Pete Elementary's 2B class. Videos and messages shared here
            are visible only to members.
          </p>
          <Fact label="Group id" value={gid} />
          <Fact label="Created" value="Sep 2024" />
          <Fact label="Members" value={`${MEMBERS.length}`} />
        </div>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground font-semibold">
        {label}
      </span>
      <span className="truncate">{value}</span>
    </div>
  );
}
