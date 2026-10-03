import { exportSessionRecord } from './exporters';
import { prepareRecoverySession } from './recovery';
import { loadRecoveryEvents, loadRecoverySnapshot } from './storage';

export async function exportIncompleteRecovery(sessionId: string): Promise<string> {
  const [raw, events] = await Promise.all([
    loadRecoverySnapshot(sessionId),
    loadRecoveryEvents(sessionId)
  ]);
  const prepared = prepareRecoverySession(raw);
  if (!prepared.ok) throw new Error(`${prepared.code}: ${prepared.diagnostic}`);
  return exportSessionRecord(prepared.session, events);
}
