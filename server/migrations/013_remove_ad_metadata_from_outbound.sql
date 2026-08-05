UPDATE messages
SET metadata = metadata - 'trafficSource' - 'trafficTitle' - 'trafficUrl'
WHERE sender = 'attendant'
  AND (metadata ? 'trafficSource' OR metadata ? 'trafficTitle' OR metadata ? 'trafficUrl');
