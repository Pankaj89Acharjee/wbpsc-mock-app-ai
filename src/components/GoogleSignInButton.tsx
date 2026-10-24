import React, { useEffect, useRef, useState } from "react";

// ============================================================================
// "Sign in with Google" via Google Identity Services (no Firebase). Google
// returns an ID token ("credential") which api-core verifies server-side.
// ============================================================================

interface GoogleIdApi {
  accounts: {
    id: {
      initialize: (config: {
        client_id: string;
        callback: (response: { credential: string }) => void;
      }) => void;
      renderButton: (el: HTMLElement, options: Record<string, unknown>) => void;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleIdApi;
  }
}

const GIS_SRC = "https://accounts.google.com/gsi/client";
let gisLoader: Promise<void> | null = null;

function loadGis(): Promise<void> {
  if (window.google?.accounts) return Promise.resolve();
  gisLoader ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = GIS_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      gisLoader = null;
      reject(new Error("Could not load Google sign-in"));
    };
    document.head.appendChild(s);
  });
  return gisLoader;
}

export default function GoogleSignInButton({
  clientId,
  onCredential,
}: {
  clientId: string;
  onCredential: (credential: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  // Keep the latest callback without re-rendering Google's button
  const callbackRef = useRef(onCredential);
  callbackRef.current = onCredential;

  useEffect(() => {
    let cancelled = false;
    loadGis()
      .then(() => {
        if (cancelled || !ref.current || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (res) => callbackRef.current(res.credential),
        });
        window.google.accounts.id.renderButton(ref.current, {
          theme: "filled_black",
          size: "large",
          text: "continue_with",
          shape: "rectangular",
          width: ref.current.offsetWidth || 320,
        });
      })
      .catch((err: Error) => setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  return (
    <div>
      <div ref={ref} className="w-full flex justify-center min-h-10" />
      {error && <p className="text-xs text-rose-300 mt-2 text-center">{error}</p>}
    </div>
  );
}
