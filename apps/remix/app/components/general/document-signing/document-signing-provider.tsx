import { isBase64Image } from '@documenso/lib/constants/signatures';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';

// D2DHQ fork: persist the signer's signature across separate documents
// in the same browser session. Documenso already persists in-memory within
// a single doc; sessionStorage extends that to the W-9 + contract + ACH
// packet flow so the signer draws once for all three.
const SESSION_SIG_KEY = 'd2dhq:lastSignature';

const readSessionSignature = (): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage.getItem(SESSION_SIG_KEY);
  } catch {
    return null;
  }
};

const writeSessionSignature = (value: string | null) => {
  if (typeof window === 'undefined') return;
  try {
    if (value) {
      window.sessionStorage.setItem(SESSION_SIG_KEY, value);
    } else {
      window.sessionStorage.removeItem(SESSION_SIG_KEY);
    }
  } catch {
    // sessionStorage can throw in private-browsing modes; swallow.
  }
};

export type DocumentSigningContextValue = {
  fullName: string;
  setFullName: (_value: string) => void;
  email: string;
  setEmail: (_value: string) => void;
  signature: string | null;
  setSignature: (_value: string | null) => void;
};

const DocumentSigningContext = createContext<DocumentSigningContextValue | null>(null);

export const useDocumentSigningContext = () => {
  return useContext(DocumentSigningContext);
};

export const useRequiredDocumentSigningContext = () => {
  const context = useDocumentSigningContext();

  if (!context) {
    throw new Error('Signing context is required');
  }

  return context;
};

export interface DocumentSigningProviderProps {
  fullName?: string | null;
  email?: string | null;
  signature?: string | null;
  typedSignatureEnabled?: boolean;
  uploadSignatureEnabled?: boolean;
  drawSignatureEnabled?: boolean;
  children: React.ReactNode;
}

export const DocumentSigningProvider = ({
  fullName: initialFullName,
  email: initialEmail,
  signature: initialSignature,
  typedSignatureEnabled = true,
  uploadSignatureEnabled = true,
  drawSignatureEnabled = true,
  children,
}: DocumentSigningProviderProps) => {
  const [fullName, setFullName] = useState(initialFullName || '');
  const [email, setEmail] = useState(initialEmail || '');

  // Pick the starting signature, in order of preference:
  //   1. initialSignature (from server: prior user signature)
  //   2. sessionStorage (a signature the same browser just drew on another
  //      D2DHQ doc — e.g. signed W-9 a minute ago, now opening the contract)
  //   3. null (signer will be prompted)
  // Honor the per-doc enabled flags either way (don't surface a drawn
  // signature if drawing is disabled, etc.).
  const [signature, setSignatureState] = useState(
    (() => {
      const candidate = initialSignature || readSessionSignature() || '';
      const isBase64 = isBase64Image(candidate);

      if (isBase64 && (uploadSignatureEnabled || drawSignatureEnabled)) {
        return candidate;
      }

      if (!isBase64 && candidate && typedSignatureEnabled) {
        return candidate;
      }

      return null;
    })(),
  );

  // Mirror every signature change to sessionStorage so subsequent docs
  // in the same session can pre-fill it. Wrapped in useCallback so the
  // identity is stable for consumers that depend on `setSignature`.
  const setSignature = useCallback((value: string | null) => {
    setSignatureState(value);
    writeSessionSignature(value);
  }, []);

  // On first mount, if we adopted a signature from sessionStorage above,
  // make sure it's also written back (covers the case where a different
  // doc seeded it but we want this provider's snapshot to be authoritative).
  useEffect(() => {
    if (signature) {
      writeSessionSignature(signature);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <DocumentSigningContext.Provider
      value={{
        fullName,
        setFullName,
        email,
        setEmail,
        signature,
        setSignature,
      }}
    >
      {children}
    </DocumentSigningContext.Provider>
  );
};

DocumentSigningProvider.displayName = 'DocumentSigningProvider';
