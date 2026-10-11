import { useEffect, useRef, useState } from 'react';
import { readAccount } from '../utils/accountAuth';
export default function useAccount() {
  const [account, setAccount] = useState({ configuration: null, user: null });
  const mounted = useRef(true);
  const generation = useRef(0);
  async function refresh() {
    const request = ++generation.current;
    const result = await readAccount();
    if (mounted.current && request === generation.current) setAccount(result);
    return result;
  }
  useEffect(() => {
    mounted.current = true; refresh();
    return () => { mounted.current = false; generation.current++; };
  }, []);
  return { ...account, refresh };
}
