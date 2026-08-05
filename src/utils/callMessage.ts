export type CallMessageInfo = {
  isCall: boolean;
  label?: string;
};

export const callMessageInfo = (record: any, message: any, type = '', fromMe = record?.key?.fromMe === true): CallMessageInfo => {
  const call = message?.callLogMessage
    || message?.call
    || message?.offerMessage
    || record?.callLogMessage
    || record?.call
    || record?.offerMessage
    || record?.data?.callLogMessage
    || record?.data?.call
    || record?.data?.offerMessage;
  const markers = [
    type,
    record?.messageType,
    record?.event,
    record?.type,
    call?.callType,
    call?.type,
    call?.callOutcome,
    call?.outcome,
    call?.callResult,
    call?.result,
    call?.status,
    call?.reason,
    record?.callOutcome,
    record?.callResult,
  ].filter((value) => value !== undefined && value !== null).map(String).join(' ').toLowerCase();
  const isCall = Boolean(call) || /call|phonecall|voicecall|voip|ligaç/.test(markers);
  if (!isCall) return { isCall: false };

  const numericOutcome = [call?.callOutcome, call?.outcome, call?.callResult, call?.result, record?.callOutcome]
    .map((value) => Number(value))
    .find((value) => Number.isInteger(value));
  const isVideo = Boolean(call?.isVideo || call?.video || /video/.test(markers));
  const explicitlyMissed = /miss|unanswered|no[_ -]?answer|not[_ -]?answer|no[_ -]?response|reject|declin|timeout|failed|cancel|unavailable|busy/.test(markers)
    // Baileys CallOutcome: MISSED=1, FAILED=2, REJECTED=3,
    // ACCEPTED_ELSEWHERE=4, SILENCED_BY_DND=6, SILENCED_UNKNOWN_CALLER=7.
    || [1, 2, 3, 4, 6, 7].includes(numericOutcome ?? -1);
  const connected = /connected|accepted|answered|completed|success|established/.test(markers)
    || numericOutcome === 0
    || Number(call?.duration || call?.durationMs || call?.durationSecs || 0) > 0;
  const missed = explicitlyMissed || (!fromMe && !connected);
  const medium = isVideo ? 'vídeo' : 'voz';
  return { isCall: true, label: `Ligação de ${medium} ${missed ? 'perdida' : fromMe ? 'realizada' : 'recebida'}` };
};
