import type { EIP1193Provider } from 'viem';

type WalletEvent = 'accountsChanged' | 'chainChanged' | 'connect' | 'disconnect';

declare global {
  interface Window {
    ethereum?: EIP1193Provider & {
      on?: (event: WalletEvent, listener: (...args: unknown[]) => void) => void;
      removeListener?: (event: WalletEvent, listener: (...args: unknown[]) => void) => void;
    };
  }
}

export {};
