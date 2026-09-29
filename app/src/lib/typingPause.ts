export interface TypingPauseParticipant {
  canToggle: () => boolean;
  toggle: () => void;
}

let participant: TypingPauseParticipant | undefined;

export function registerTypingPauseParticipant(value: TypingPauseParticipant): () => void {
  participant = value;
  return () => {
    if (participant === value) participant = undefined;
  };
}

export function canToggleTypingPause(): boolean {
  return participant?.canToggle() ?? false;
}

export function toggleTypingPause(): boolean {
  if (!participant?.canToggle()) return false;
  participant.toggle();
  return true;
}
