import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { KuboWordmark } from '@/components/KuboWordmark';

/**
 * /onboard/welcome — first screen an unauthenticated visitor sees.
 *
 * Purely visual in this PR. Button handlers just navigate; the real
 * signup pipeline (key generation, kind-0 publish, credential manager)
 * is wired in a later data-layer PR.
 */
export function WelcomePage() {
  const nav = useNavigate();

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-10 text-center max-w-sm mx-auto w-full">
      <div className="flex flex-col items-center gap-6">
        <KuboWordmark className="h-16 text-foreground" />
        <h1 className="text-2xl font-semibold tracking-tight">
          Safe video for kids with controls parents trust.
        </h1>
      </div>

      <div className="w-full flex flex-col gap-3">
        <Button
          size="lg"
          className="w-full h-12 rounded-full"
          onClick={() => nav('/onboard/create-parent')}
        >
          Create account
        </Button>
        <Button
          variant="ghost"
          size="lg"
          className="w-full h-12"
          onClick={() => nav('/onboard/login')}
        >
          Sign in
        </Button>
      </div>
    </div>
  );
}
