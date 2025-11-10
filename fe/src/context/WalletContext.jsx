import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { BrowserProvider, formatEther } from "ethers";

const WalletContext = createContext({
  address: "",
  isConnected: false,
  connect: async () => {},
  disconnect: () => {},
  profile: null,
  needsProfile: false,
  setNeedsProfile: () => {},
  saveProfile: async () => {},
  nativeBalance: null,
  nativeSymbol: 'ETH',
  refreshNative: async () => {},
  isAdmin: false,
  adminChecked: false,
  refreshAdmin: async () => {},
});

function readProfile(addr) {
  if (!addr) return null;
  try { const raw = localStorage.getItem(`profile:${addr.toLowerCase()}`); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

async function fetchProfileFromServer(addr) {
  try {
    const apiBase = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_BASE) || '/api';
    const res = await fetch(`${apiBase}/users/${addr}`);
    if (!res.ok) return null;
    const data = await res.json();
    return { username: data.username||'', email: data.email||'' };
  } catch { return null; }
}

export function WalletProvider({ children }) {
  const [address, setAddress] = useState(() => localStorage.getItem("walletAddress") || "");
  const [profile, setProfile] = useState(() => readProfile(localStorage.getItem("walletAddress")));
  const [needsProfile, setNeedsProfile] = useState(false);
  const [nativeBalance, setNativeBalance] = useState(null);
  const [nativeSymbol, setNativeSymbol] = useState('ETH');
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminChecked, setAdminChecked] = useState(false);

  const refreshAdmin = useCallback(async () => {
    try {
      const envAdmins = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_ADMIN_ADDRESSES) || (typeof process !== 'undefined' && process.env?.VITE_ADMIN_ADDRESSES) || "";
      const ok = !!(address && envAdmins.split(',').map(s=>s.trim().toLowerCase()).filter(Boolean).includes(String(address).toLowerCase()));
      setIsAdmin(ok);
      setAdminChecked(true);
      return ok;
    } catch {
      setIsAdmin(false); setAdminChecked(true); return false;
    }
  }, [address]);

  const symbolByChain = (chainId) => {
    switch (Number(chainId)) {
      case 1:
      case 11155111:
      case 8453:
        return 'ETH';
      case 137:
      case 80002:
        return 'MATIC';
      case 56:
        return 'BNB';
      default:
        return 'ETH';
    }
  };

  const refreshNative = useCallback(async () => {
    try {
      if (!address || !window.ethereum) return;
      const p = new BrowserProvider(window.ethereum);
      const [bal, net] = await Promise.all([
        p.getBalance(address),
        p.getNetwork(),
      ]);
      setNativeBalance(formatEther(bal));
      setNativeSymbol(symbolByChain(net.chainId));
    } catch {}
  }, [address]);

  const connect = useCallback(async () => {
    if (!window.ethereum) throw new Error("Vui lòng cài đặt MetaMask");
    const provider = new BrowserProvider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    const signer = await provider.getSigner();
    const addr = (await signer.getAddress())?.toLowerCase();
    setAddress(addr);
    localStorage.setItem("walletAddress", addr);
    let p = readProfile(addr);
    if (!p || !p.username) {
      const serverP = await fetchProfileFromServer(addr);
      if (serverP) { p = serverP; localStorage.setItem(`profile:${addr}`, JSON.stringify(serverP)); if (serverP.email) localStorage.setItem('userEmail', serverP.email); }
    }
    setProfile(p);
    setNeedsProfile(!p || !p.username);
    // fetch native balance
    await refreshNative();
    await refreshAdmin();
    return addr;
  }, [refreshNative, refreshAdmin]);

  const disconnect = useCallback(() => {
    setAddress("");
    setProfile(null);
    setNeedsProfile(false);
    localStorage.removeItem("walletAddress");
  }, []);

  const saveProfile = useCallback(async (username, email) => {
    if (!address) return;
    const data = { username: String(username||"").trim(), email: String(email||"").trim() };
    localStorage.setItem(`profile:${address.toLowerCase()}`, JSON.stringify(data));
    // Back-compat for components reading userEmail
    if (data.email) localStorage.setItem('userEmail', data.email); else localStorage.removeItem('userEmail');
    // sync to server if available
    try {
      const apiBase = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_BASE) || '/api';
      await fetch(`${apiBase}/users`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address, ...data }) });
    } catch {}
    setProfile(data);
    setNeedsProfile(false);
    return data;
  }, [address]);

  useEffect(() => {
    if (!window.ethereum) return;
    (async () => {
      try {
        const provider = new BrowserProvider(window.ethereum);
        const accounts = await provider.send("eth_accounts", []);
        if (accounts && accounts[0]) {
          const addr = accounts[0].toLowerCase();
          setAddress(addr);
          localStorage.setItem("walletAddress", addr);
          let p = readProfile(addr);
          if (!p || !p.username) {
            const serverP = await fetchProfileFromServer(addr);
            if (serverP) { p = serverP; localStorage.setItem(`profile:${addr}`, JSON.stringify(serverP)); if (serverP.email) localStorage.setItem('userEmail', serverP.email); }
          }
          setProfile(p);
          setNeedsProfile(!p || !p.username);
          // fetch native balance
          try { await refreshNative(); } catch {}
          try { await refreshAdmin(); } catch {}
        }
      } catch {}
    })();

    const handleAccountsChanged = (accounts) => {
      const next = (accounts && accounts[0]) ? accounts[0].toLowerCase() : "";
      setAddress(next);
      if (next) {
        localStorage.setItem("walletAddress", next);
        let p = readProfile(next);
        // try server
        fetchProfileFromServer(next).then(serverP => {
          if (serverP) {
            localStorage.setItem(`profile:${next}`, JSON.stringify(serverP));
            if (serverP.email) localStorage.setItem('userEmail', serverP.email);
            setProfile(serverP);
            setNeedsProfile(!serverP.username);
          }
        }).catch(()=>{});
        setProfile(p);
        setNeedsProfile(!p || !p.username);
        // refresh balance for new account
        try { (async () => { await refreshNative(); })(); } catch {}
        try { (async () => { await refreshAdmin(); })(); } catch {}
      } else {
        localStorage.removeItem("walletAddress");
        setProfile(null);
        setNeedsProfile(false);
        setNativeBalance(null);
      }
    };
    const handleChainChanged = () => { window.location.reload(); };
    window.ethereum.on?.("accountsChanged", handleAccountsChanged);
    window.ethereum.on?.("chainChanged", handleChainChanged);
    return () => {
      window.ethereum.removeListener?.("accountsChanged", handleAccountsChanged);
      window.ethereum.removeListener?.("chainChanged", handleChainChanged);
    };
  }, [refreshNative, refreshAdmin]);

  return (
    <WalletContext.Provider value={{ address, isConnected: !!address, connect, disconnect, profile, needsProfile, setNeedsProfile, saveProfile, nativeBalance, nativeSymbol, refreshNative, isAdmin, adminChecked, refreshAdmin }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() { return useContext(WalletContext); }

