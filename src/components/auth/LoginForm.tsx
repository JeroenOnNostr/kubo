import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  Loader2,
  Upload,
} from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { QRCodeCanvas } from '@/components/ui/qrcode';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAppContext } from '@/hooks/useAppContext';
import { useIsMobile } from '@/hooks/useIsMobile';
import {
  type NostrConnectParams,
  generateNostrConnectParams,
  generateNostrConnectURI,
  useLoginActions,
} from '@/hooks/useLoginActions';
import { useShareOrigin } from '@/hooks/useShareOrigin';
import { getNsecCredential } from '@/lib/credentialManager';

const validateNsec = (nsec: string) => /^nsec1[a-zA-Z0-9]{58}$/.test(nsec);
const validateBunkerUri = (uri: string) => uri.startsWith('bunker://');

interface LoginFormProps {
  /** Called once a login (any method) has been successfully added to the
   * Nostrify login store. The caller decides where to navigate next. */
  onLogin: () => void;
  /** Optional progressive-enhancement: when true, on mount we attempt to
   * read a saved credential from the platform credential manager and
   * auto-login if it's a valid nsec. */
  autoTryCredential?: boolean;
}

/**
 * Standalone login form — extension button + Secret Key / Remote Signer tabs.
 * Intended for inline use on a full-screen page (e.g. /onboard/login). For the
 * modal entry-point used by MainLayout, see LoginDialog (which keeps its own
 * dialog chrome and is explicitly upstream-stable).
 *
 * This is a separate component, not a refactor of LoginDialog, because
 * LoginDialog carries an upstream-stability banner — we duplicate the
 * Nostrify wiring rather than couple the two consumers.
 */
export function LoginForm({ onLogin, autoTryCredential = false }: LoginFormProps) {
  const { config } = useAppContext();
  const shareOrigin = useShareOrigin();
  const login = useLoginActions();
  const isMobile = useIsMobile();
  const hasExtension = typeof window !== 'undefined' && 'nostr' in window;

  const [isLoading, setIsLoading] = useState(false);
  const [isFileLoading, setIsFileLoading] = useState(false);
  const [nsec, setNsec] = useState('');
  const [bunkerUri, setBunkerUri] = useState('');
  const [showBunkerInput, setShowBunkerInput] = useState(false);
  const [isMoreOptionsOpen, setIsMoreOptionsOpen] = useState(false);
  const [errors, setErrors] = useState<{
    nsec?: string;
    bunker?: string;
    file?: string;
    extension?: string;
  }>({});

  const [nostrConnectParams, setNostrConnectParams] =
    useState<NostrConnectParams | null>(null);
  const [nostrConnectUri, setNostrConnectUri] = useState<string>('');
  const [isWaitingForConnect, setIsWaitingForConnect] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Keep onLogin in a ref so the nostrconnect listener effect doesn't
  // restart every render just because the caller passed a fresh closure.
  const onLoginRef = useRef(onLogin);
  useEffect(() => {
    onLoginRef.current = onLogin;
  }, [onLogin]);

  const executeLogin = useCallback(
    (key: string) => {
      setIsLoading(true);
      setErrors({});
      // setTimeout lets the disabled-state render before the sync nsec
      // decode + signer construction runs.
      setTimeout(() => {
        try {
          login.nsec(key);
          onLoginRef.current();
        } catch {
          setErrors({
            nsec: "Failed to login with this key. Please check that it's correct.",
          });
          setIsLoading(false);
        }
      }, 50);
    },
    [login],
  );

  // Progressive enhancement: pull a stored credential from the OS / browser
  // password manager when the form mounts (iOS Keychain, Chromium picker).
  useEffect(() => {
    if (!autoTryCredential) return;
    let cancelled = false;
    getNsecCredential().then((cred) => {
      if (cancelled || !cred) return;
      if (validateNsec(cred.nsec)) {
        executeLogin(cred.nsec);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [autoTryCredential, executeLogin]);

  const generateConnectSession = useCallback(() => {
    const relayUrls = login.getRelayUrls();
    const params = generateNostrConnectParams(relayUrls);
    const isMobileDevice =
      typeof navigator !== 'undefined' &&
      /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const uri = generateNostrConnectURI(params, {
      name: config.appName,
      callback: isMobileDevice ? `${shareOrigin}/remoteloginsuccess` : undefined,
    });
    setNostrConnectParams(params);
    setNostrConnectUri(uri);
    setConnectError(null);
  }, [login, config.appName, shareOrigin]);

  // Listen for the signer to respond once params are generated.
  useEffect(() => {
    if (!nostrConnectParams || isWaitingForConnect) return;
    let cancelled = false;
    const startListening = async () => {
      setIsWaitingForConnect(true);
      abortControllerRef.current = new AbortController();
      try {
        await login.nostrconnect(nostrConnectParams, abortControllerRef.current.signal);
        if (!cancelled) onLoginRef.current();
      } catch (error) {
        if (cancelled) return;
        if (error instanceof Error && error.name === 'AbortError') return;
        console.error('Nostrconnect failed:', error);
        setConnectError(error instanceof Error ? error.message : String(error));
        setIsWaitingForConnect(false);
      }
    };
    startListening();
    return () => {
      cancelled = true;
    };
  }, [nostrConnectParams, login, isWaitingForConnect]);

  // Abort any in-flight nostrconnect listener when the form unmounts.
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, []);

  const handleRetry = useCallback(() => {
    setNostrConnectParams(null);
    setNostrConnectUri('');
    setIsWaitingForConnect(false);
    setConnectError(null);
    setTimeout(() => generateConnectSession(), 0);
  }, [generateConnectSession]);

  const handleCopyUri = async () => {
    await navigator.clipboard.writeText(nostrConnectUri);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenSignerApp = () => {
    if (!nostrConnectUri) return;
    window.location.href = nostrConnectUri;
  };

  const handleExtensionLogin = async () => {
    setIsLoading(true);
    setErrors((prev) => ({ ...prev, extension: undefined }));
    try {
      if (!('nostr' in window)) {
        throw new Error('Nostr extension not found. Please install a NIP-07 extension.');
      }
      await login.extension();
      onLoginRef.current();
    } catch (e: unknown) {
      const error = e as Error;
      console.error('Extension login failed:', error);
      setErrors((prev) => ({
        ...prev,
        extension: error instanceof Error ? error.message : 'Extension login failed',
      }));
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyLogin = () => {
    if (!nsec.trim()) {
      setErrors((prev) => ({ ...prev, nsec: 'Please enter your secret key' }));
      return;
    }
    if (!validateNsec(nsec)) {
      setErrors((prev) => ({
        ...prev,
        nsec: 'Invalid secret key format. Must be a valid nsec starting with nsec1.',
      }));
      return;
    }
    executeLogin(nsec);
  };

  const handleBunkerLogin = async () => {
    if (!bunkerUri.trim()) {
      setErrors((prev) => ({ ...prev, bunker: 'Please enter a bunker URI' }));
      return;
    }
    if (!validateBunkerUri(bunkerUri)) {
      setErrors((prev) => ({
        ...prev,
        bunker: 'Invalid bunker URI format. Must start with bunker://',
      }));
      return;
    }
    setIsLoading(true);
    setErrors((prev) => ({ ...prev, bunker: undefined }));
    try {
      await login.bunker(bunkerUri);
      onLoginRef.current();
      setBunkerUri('');
    } catch {
      setErrors((prev) => ({
        ...prev,
        bunker: 'Failed to connect to bunker. Please check the URI.',
      }));
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsFileLoading(true);
    setErrors({});
    const reader = new FileReader();
    reader.onload = (event) => {
      setIsFileLoading(false);
      const content = event.target?.result as string;
      if (content) {
        const trimmed = content.trim();
        if (validateNsec(trimmed)) {
          executeLogin(trimmed);
        } else {
          setErrors({ file: 'File does not contain a valid secret key.' });
        }
      } else {
        setErrors({ file: 'Could not read file content.' });
      }
    };
    reader.onerror = () => {
      setIsFileLoading(false);
      setErrors({ file: 'Failed to read file.' });
    };
    reader.readAsText(file);
  };

  const renderTabs = () => (
    <Tabs
      defaultValue="key"
      className="w-full"
      onValueChange={(value) => {
        if (value === 'remote' && !nostrConnectParams && !connectError) {
          generateConnectSession();
        }
      }}
    >
      <TabsList className="grid w-full grid-cols-2 bg-muted/80 rounded-lg mb-4">
        <TabsTrigger value="key" className="flex items-center gap-2">
          <span>Secret Key</span>
        </TabsTrigger>
        <TabsTrigger value="remote" className="flex items-center gap-2">
          <span>Remote Signer</span>
        </TabsTrigger>
      </TabsList>

      <TabsContent value="key" className="space-y-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleKeyLogin();
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Input
              id="nsec"
              type="password"
              value={nsec}
              onChange={(e) => {
                setNsec(e.target.value);
                if (errors.nsec) setErrors((prev) => ({ ...prev, nsec: undefined }));
              }}
              className={`rounded-lg ${
                errors.nsec ? 'border-red-500 focus-visible:ring-red-500' : ''
              }`}
              placeholder="nsec1..."
              autoComplete="off"
            />
            {errors.nsec && <p className="text-sm text-red-500">{errors.nsec}</p>}
          </div>

          <div className="flex space-x-2">
            <Button
              type="submit"
              size="lg"
              disabled={isLoading || !nsec.trim()}
              className="flex-1"
            >
              {isLoading ? 'Verifying...' : 'Log in'}
            </Button>

            <input
              type="file"
              accept=".txt"
              className="hidden"
              ref={fileInputRef}
              onChange={handleFileUpload}
            />
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading || isFileLoading}
              className="px-3"
            >
              <Upload className="w-4 h-4" />
            </Button>
          </div>

          {errors.file && (
            <p className="text-sm text-red-500 text-center">{errors.file}</p>
          )}
        </form>
      </TabsContent>

      <TabsContent value="remote" className="space-y-4">
        <div className="flex flex-col items-center space-y-4">
          {connectError ? (
            <div className="flex flex-col items-center space-y-4 py-4">
              <p className="text-sm text-red-500 text-center">{connectError}</p>
              <Button variant="outline" onClick={handleRetry}>
                Retry
              </Button>
            </div>
          ) : nostrConnectUri ? (
            <>
              {!isMobile && (
                <div className="p-4 bg-white dark:bg-white rounded-xl">
                  <QRCodeCanvas value={nostrConnectUri} size={180} level="M" />
                </div>
              )}
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>
                  {isMobile ? 'Tap to open your signer app' : 'Scan with your signer app'}
                </span>
              </div>
              {isMobile && (
                <Button
                  className="w-full gap-2 py-6 rounded-full"
                  onClick={handleOpenSignerApp}
                >
                  <ExternalLink className="w-5 h-5" />
                  Open Signer App
                </Button>
              )}
              <Button
                variant="outline"
                size={isMobile ? 'default' : 'sm'}
                className={isMobile ? 'w-full gap-2 rounded-full' : 'gap-2'}
                onClick={handleCopyUri}
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    Copy URI
                  </>
                )}
              </Button>
            </>
          ) : (
            <div className="flex items-center justify-center h-[100px]">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>

        <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
          <button
            type="button"
            onClick={() => setShowBunkerInput(!showBunkerInput)}
            className="flex items-center justify-center gap-2 w-full text-sm text-muted-foreground hover:text-foreground transition-colors py-2"
          >
            <span>Enter bunker URI manually</span>
            {showBunkerInput ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </button>

          {showBunkerInput && (
            <div className="space-y-3 mt-3">
              <div className="space-y-2">
                <Input
                  id="connectBunkerUri"
                  value={bunkerUri}
                  onChange={(e) => setBunkerUri(e.target.value)}
                  className="rounded-lg border-gray-300 dark:border-gray-700 focus-visible:ring-primary text-base md:text-sm"
                  placeholder="bunker://"
                />
                {bunkerUri && !validateBunkerUri(bunkerUri) && (
                  <p className="text-red-500 text-xs">Invalid bunker URI format</p>
                )}
              </div>
              <Button
                className="w-full rounded-full py-4"
                variant="outline"
                onClick={handleBunkerLogin}
                disabled={isLoading || !bunkerUri.trim() || !validateBunkerUri(bunkerUri)}
              >
                {isLoading ? 'Connecting...' : 'Connect'}
              </Button>
            </div>
          )}
        </div>
      </TabsContent>
    </Tabs>
  );

  return (
    <div className="space-y-4">
      {hasExtension && (
        <div className="space-y-3">
          {errors.extension && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{errors.extension}</AlertDescription>
            </Alert>
          )}
          <Button
            className="w-full h-12"
            onClick={handleExtensionLogin}
            disabled={isLoading}
          >
            {isLoading ? 'Logging in...' : 'Log in with Extension'}
          </Button>
        </div>
      )}

      {hasExtension ? (
        <Collapsible
          className="space-y-4"
          open={isMoreOptionsOpen}
          onOpenChange={setIsMoreOptionsOpen}
        >
          <button
            type="button"
            onClick={() => setIsMoreOptionsOpen(!isMoreOptionsOpen)}
            className="w-full flex items-center justify-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors py-2"
          >
            <span>More Options</span>
            <ChevronDown
              className={`w-4 h-4 transition-transform ${isMoreOptionsOpen ? 'rotate-180' : ''}`}
            />
          </button>
          <CollapsibleContent>{renderTabs()}</CollapsibleContent>
        </Collapsible>
      ) : (
        renderTabs()
      )}
    </div>
  );
}
