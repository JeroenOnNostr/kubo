import { useEffect, useRef } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';

/**
 * Android back-button / back-gesture guard for /kid/* routes.
 *
 * The browser back stack at the moment a kid lands in /kid still contains
 * the parent route they came from (BootGate redirect, signer swap), so a
 * hardware back would otherwise pop straight into /parent/* without a PIN —
 * defeating the gate. This guard intercepts the event and either:
 *
 *   - lets in-tree back work (e.g. /kid/post/:id back to /kid)
 *   - opens the ParentGateDialog when the previous entry would leave /kid/*
 *
 * Tracks a small kid-internal depth counter using react-router's
 * useNavigationType() so we can tell PUSH from POP cleanly. When depth is
 * zero, back means "leave the tree" and we open the gate instead.
 *
 * Native-only — Capacitor's backButton event doesn't fire on web, and the
 * dynamic import keeps @capacitor/app out of the web critical path.
 */
export function useKidBackGuard(opts: { onRequestExit: () => void }) {
  const location = useLocation();
  const navType = useNavigationType(); // 'PUSH' | 'POP' | 'REPLACE'
  const navigate = useNavigate();
  const { onRequestExit } = opts;

  const depthRef = useRef(0);
  const wasInKidRef = useRef(false);

  useEffect(() => {
    const inKid = location.pathname.startsWith('/kid');

    if (!inKid) {
      depthRef.current = 0;
      wasInKidRef.current = false;
      return;
    }

    if (!wasInKidRef.current) {
      // Just entered the kid tree — reset the boundary.
      depthRef.current = 0;
      wasInKidRef.current = true;
      return;
    }

    if (navType === 'PUSH') {
      depthRef.current += 1;
    } else if (navType === 'POP') {
      depthRef.current = Math.max(0, depthRef.current - 1);
    }
    // REPLACE leaves depth unchanged.
  }, [location.pathname, navType]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let cleanup: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      const { App } = await import('@capacitor/app');

      const handler = () => {
        if (!window.location.pathname.startsWith('/kid')) return;

        if (depthRef.current <= 0) {
          onRequestExit();
          return;
        }

        navigate(-1);
      };

      const listener = await App.addListener('backButton', handler);
      if (cancelled) {
        listener.remove();
        return;
      }
      cleanup = () => listener.remove();
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [navigate, onRequestExit]);
}
