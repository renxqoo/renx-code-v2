import { useCallback, useState } from 'react';

import { __SERVICE_NAME__ } from './service';

export interface __HOOK_NAME__Result {
  data: __DATA_TYPE__ | null;
  error: Error | null;
  isLoading: boolean;
  reload: () => Promise<void>;
}

export function use__HOOK_NAME__(): __HOOK_NAME__Result {
  const [data, setData] = useState<__DATA_TYPE__ | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const reload = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const next = await __SERVICE_NAME__();
      setData(next);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError : new Error('Unknown error'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    data,
    error,
    isLoading,
    reload,
  };
}
