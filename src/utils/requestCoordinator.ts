export const createInFlightRequestCoordinator = <T>() => {
  const requests = new Map<string, Promise<T>>();

  const run = (key: string, requestFactory: () => Promise<T>) => {
    const existing = requests.get(key);
    if (existing) return existing;

    const request = Promise.resolve().then(requestFactory);
    requests.set(key, request);
    request.then(
      () => {
        if (requests.get(key) === request) requests.delete(key);
      },
      () => {
        if (requests.get(key) === request) requests.delete(key);
      },
    );
    return request;
  };

  return { run };
};

export const createLatestRequestGuard = () => {
  let latestRequest = 0;

  return {
    begin: () => {
      latestRequest += 1;
      return latestRequest;
    },
    isLatest: (requestId: number) => requestId === latestRequest,
  };
};
